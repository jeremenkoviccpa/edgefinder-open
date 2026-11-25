"""Macro data: actuals from FRED, consensus forecasts from the ForexFactory
weekly JSON feed.

A1 scores most releases as actual-vs-forecast ("surprise"). FRED has the
actuals (US) but no consensus; ForexFactory publishes consensus for the
current week only, with no actuals. So each run snapshots the FF feed into
SQLite, and later matches a stored forecast to the FRED observation it was
for. Until a forecast is on file, we fall back to actual-vs-previous.

Coverage: US only. Non-US actual+forecast needs a calendar provider (see
FINDINGS.md); those categories score 0 for now.
"""
import io
import os
import re
import time
from datetime import date, datetime, timedelta, timezone

import pandas as pd
import requests

from ..config import DATA_DIR, HTTP_HEADERS, POLICY_RATE_FRED
from ..db import conn

FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={}"
FRED_API = "https://api.stlouisfed.org/fred/series/observations"
FRED_API_KEY = os.getenv("FRED_API_KEY")
FRED_CACHE = DATA_DIR / "fred"
FRED_CACHE.mkdir(exist_ok=True)
FF_FEED = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"

# key -> FRED series, transform, frequency, FF title regex, group, good_dir
#   good_dir: +1 if a higher number = stronger economy, -1 if lower is stronger
#   transform output is in "base units" (e.g. NFP in jobs, not thousands)
US_INDICATORS = {
    "gdp":          dict(fred="A191RL1Q225SBEA", tf="level", freq="Q", ff=r"^(Advance|Prelim|Final) GDP q/q$", label="GDP Growth QoQ (ann.)", unit="%"),
    "retail_sales": dict(fred="RSAFS", tf="mom", freq="M", ff=r"^Retail Sales m/m$", label="Retail Sales MoM", unit="%"),
    "consumer_sent": dict(fred="UMCSENT", tf="level", freq="M", ff=r"UoM Consumer Sentiment$", label="UMich Consumer Sentiment", unit=""),
    "cpi_yoy":      dict(fred="CPIAUCSL", tf="yoy", freq="M", ff=r"^CPI y/y$", label="CPI YoY", unit="%"),
    "core_cpi_mom": dict(fred="CPILFESL", tf="mom", freq="M", ff=r"^Core CPI m/m$", label="Core CPI MoM", unit="%"),
    "ppi_mom":      dict(fred="PPIFIS", tf="mom", freq="M", ff=r"^PPI m/m$", label="PPI MoM", unit="%"),
    "core_pce_mom": dict(fred="PCEPILFE", tf="mom", freq="M", ff=r"^Core PCE Price Index m/m$", label="Core PCE MoM", unit="%"),
    "nfp":          dict(fred="PAYEMS", tf="diff_x1000", freq="M", ff=r"^Non-Farm Employment Change$", label="Non-Farm Payrolls", unit="jobs"),
    "unemployment": dict(fred="UNRATE", tf="level", freq="M", ff=r"^Unemployment Rate$", label="Unemployment Rate", unit="%", good_dir=-1),
    "claims":       dict(fred="ICSA", tf="level", freq="W", ff=r"^Unemployment Claims$", label="Weekly Jobless Claims", unit="", good_dir=-1),
    "adp":          dict(fred="ADPMNUSNERSA", tf="diff", freq="M", ff=r"^ADP Non-Farm Employment Change$", label="ADP Employment Change", unit="jobs"),
    "jolts":        dict(fred="JTSJOL", tf="level_x1000", freq="M", ff=r"^JOLTS Job Openings$", label="JOLTS Job Openings", unit=""),
}

MATCH_WINDOW = {"W": 12, "M": 50, "Q": 100}   # days after period end a release can land
PERIOD_LEN = {"W": 6, "M": 31, "Q": 92}


def _fred_download(series_id: str) -> pd.Series:
    if FRED_API_KEY:  # official API: reliable, free key from fred.stlouisfed.org
        r = requests.get(FRED_API, params={"series_id": series_id, "api_key": FRED_API_KEY, "file_type": "json"},
                         timeout=(10, 30))
        r.raise_for_status()
        obs = r.json()["observations"]
        s = pd.Series([o["value"] for o in obs], index=pd.to_datetime([o["date"] for o in obs]))
    else:  # keyless CSV export: throttles bursts and some user agents
        r = requests.get(FRED_CSV.format(series_id), timeout=(10, 30))
        r.raise_for_status()
        df = pd.read_csv(io.StringIO(r.text))
        s = pd.Series(df.iloc[:, 1].values, index=pd.to_datetime(df.iloc[:, 0]))
    return pd.to_numeric(s, errors="coerce").dropna()


def fred_series(series_id: str, max_age: int = 6 * 3600) -> pd.Series:
    path = FRED_CACHE / f"{series_id}.csv"
    if path.exists() and time.time() - path.stat().st_mtime < max_age:
        return pd.read_csv(path, index_col=0, parse_dates=True).iloc[:, 0]
    err = None
    for wait in (0, 3, 10):
        time.sleep(wait)
        try:
            s = _fred_download(series_id)
            s.rename(series_id).to_csv(path)
            time.sleep(0.5)  # be gentle
            return s
        except Exception as e:
            err = e
    if path.exists():  # stale beats nothing
        return pd.read_csv(path, index_col=0, parse_dates=True).iloc[:, 0]
    raise RuntimeError(f"FRED {series_id}: {err}")


def _transform(s: pd.Series, tf: str) -> pd.Series:
    return {
        "level": lambda x: x,
        "level_x1000": lambda x: x * 1000,
        "mom": lambda x: x.pct_change(fill_method=None) * 100,
        "yoy": lambda x: x.pct_change(12, fill_method=None) * 100,
        "diff": lambda x: x.diff(),
        "diff_x1000": lambda x: x.diff() * 1000,
    }[tf](s).dropna()


def parse_ff_value(v: str | None) -> float | None:
    if not v:
        return None
    m = re.match(r"^\s*(-?[\d.]+)\s*([KMB%]?)", v)
    if not m:
        return None
    num = float(m.group(1))
    return num * {"K": 1e3, "M": 1e6, "B": 1e9}.get(m.group(2), 1)


def snapshot_ff() -> int:
    r = requests.get(FF_FEED, headers=HTTP_HEADERS, timeout=30)
    r.raise_for_status()
    events = r.json()
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with conn() as c:
        for e in events:
            # keep the last non-empty forecast we saw before the release
            c.execute(
                """INSERT INTO ff_events VALUES (?,?,?,?,?,?,?)
                   ON CONFLICT(title,country,date) DO UPDATE SET
                     forecast=COALESCE(NULLIF(excluded.forecast,''), ff_events.forecast),
                     previous=excluded.previous, impact=excluded.impact, seen_at=excluded.seen_at""",
                (e["title"], e["country"], e["date"], e["impact"], e.get("forecast", ""), e.get("previous", ""), now),
            )
    return len(events)


def _ff_forecast(pattern: str, currency: str, obs_date: pd.Timestamp, freq: str) -> tuple[float | None, str | None]:
    period_end = obs_date + timedelta(days=PERIOD_LEN[freq])
    lo, hi = period_end.date().isoformat(), (period_end + timedelta(days=MATCH_WINDOW[freq])).date().isoformat()
    today = date.today().isoformat() + "T23:59"
    with conn() as c:
        rows = c.execute(
            "SELECT title, date, forecast FROM ff_events WHERE country=? AND date>=? AND date<=? AND date<=? ORDER BY date DESC",
            (currency, lo, hi, today),
        ).fetchall()
    for title, d, fc in rows:
        if re.search(pattern, title) and parse_ff_value(fc) is not None:
            return parse_ff_value(fc), d[:10]
    return None, None


def us_indicators() -> dict[str, dict]:
    out = {}
    for key, spec in US_INDICATORS.items():
        try:
            s = _transform(fred_series(spec["fred"]), spec["tf"])
        except Exception as e:  # one bad series shouldn't kill the run
            out[key] = {"label": spec["label"], "error": str(e)}
            continue
        if len(s) < 2:
            continue
        obs_date, actual, previous = s.index[-1], float(s.iloc[-1]), float(s.iloc[-2])
        forecast, release = _ff_forecast(spec["ff"], "USD", obs_date, spec["freq"])
        if forecast is not None:
            surprise, basis = actual - forecast, "forecast"
        else:
            surprise, basis = actual - previous, "previous"
        out[key] = {
            "label": spec["label"], "unit": spec["unit"], "period": obs_date.date().isoformat(),
            "actual": round(actual, 4), "forecast": forecast, "previous": round(previous, 4),
            "surprise": round(surprise, 4), "basis": basis, "release": release,
            "good_dir": spec.get("good_dir", 1),
        }
    return out


def us_2y_trend() -> dict:
    """A1 shows 'US02Yield (21 day SMA)': rising 2y = hawkish."""
    s = fred_series("DGS2")
    sma = s.rolling(21).mean().dropna()
    slope = float(sma.iloc[-1] - sma.iloc[-11])
    return {"yield": float(s.iloc[-1]), "sma21": round(float(sma.iloc[-1]), 3), "slope_10d": round(slope, 3),
            "state": "rising" if slope > 0.05 else "falling" if slope < -0.05 else "flat"}


def policy_rates() -> dict[str, dict]:
    out = {}
    for ccy, sid in POLICY_RATE_FRED.items():
        try:
            s = fred_series(sid)
        except Exception as e:
            out[ccy] = {"error": str(e)}
            continue
        cutoff = s.index[-1] - pd.Timedelta(days=182)
        prior = s[s.index <= cutoff]
        change = float(s.iloc[-1] - prior.iloc[-1]) if len(prior) else 0.0
        out[ccy] = {"rate": float(s.iloc[-1]), "as_of": s.index[-1].date().isoformat(), "change_6m": round(change, 3)}
    return out
