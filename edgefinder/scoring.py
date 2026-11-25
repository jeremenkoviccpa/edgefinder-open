"""EdgeFinder-style scoring, implemented from A1 Trading's published rules
(a1trading.com/edgefinder/<feature>/ pages). Each column is a small integer;
the asset total is their sum. A total of +/-5 or more is a directional bias.
"""
from datetime import date

import numpy as np
import pandas as pd

from .config import ASSETS, CURRENCY_COT

COLUMNS = ["COT", "Retail", "Seasonality", "Trend",
           "GDP", "Retail Sales", "Cons. Sent.",
           "CPI", "PPI", "PCE",
           "NFP", "Unemployment", "Claims", "Rates"]
GROUPS = {
    "sentiment": ["COT", "Retail"],
    "technical": ["Seasonality", "Trend"],
    "fundamental": ["GDP", "Retail Sales", "Cons. Sent.", "CPI", "PPI", "PCE", "NFP", "Unemployment", "Claims", "Rates"],
}

# How a "stronger economy" surprise maps onto each asset class.
# fx: hawkish/strong data supports the currency (incl. hot inflation).
# metals: strong growth/labour and hot inflation -> tighter policy -> bearish gold.
# index/crypto: growth good, hot inflation bad.  commodities: everything "hot" is demand.
POLARITY = {
    "fx":        {"growth": 1, "inflation": 1, "labor": 1},
    "index":     {"growth": 1, "inflation": -1, "labor": 1},
    "crypto":    {"growth": 1, "inflation": -1, "labor": 1},
    "metal":     {"growth": -1, "inflation": -1, "labor": -1},
    "commodity": {"growth": 1, "inflation": 1, "labor": 1},
}
RATES_POLARITY = {"index": -1, "crypto": -1, "metal": -1, "commodity": 0}  # rising 2y -> ...

MACRO_COLS = {  # column -> (indicator keys, group)
    "GDP": (["gdp"], "growth"),
    "Retail Sales": (["retail_sales"], "growth"),
    "Cons. Sent.": (["consumer_sent"], "growth"),
    "CPI": (["cpi_yoy", "core_cpi_mom"], "inflation"),   # A1 adds core CPI for non-FX assets
    "PPI": (["ppi_mom"], "inflation"),
    "PCE": (["core_pce_mom"], "inflation"),
    "NFP": (["nfp"], "labor"),
    "Unemployment": (["unemployment"], "labor"),
    "Claims": (["claims"], "labor"),
}


def sign(x, eps: float = 1e-9) -> int:
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return 0
    return 1 if x > eps else -1 if x < -eps else 0


# ---------- technical ----------

def trend_score(close: pd.Series) -> tuple[int, dict]:
    """A1: 3-day vs 14-day SMA crossover, adjusted by the 14-day SMA slope.
    Crossover gives +/-2; it is pulled 1 toward zero when the slope disagrees."""
    if len(close) < 20:
        return 0, {}
    sma3, sma14 = close.rolling(3).mean(), close.rolling(14).mean()
    slope = sma14.iloc[-1] - sma14.iloc[-2]
    cross = 2 if sma3.iloc[-1] > sma14.iloc[-1] else -2
    if cross > 0 and slope < 0:
        cross -= 1
    elif cross < 0 and slope > 0:
        cross += 1
    sma = {n: float(close.rolling(n).mean().iloc[-1]) for n in (20, 50, 100, 200) if len(close) >= n}
    return cross, {"price": float(close.iloc[-1]), "sma3": float(sma3.iloc[-1]), "sma14": float(sma14.iloc[-1]),
                   "sma14_slope": float(slope), "above_sma": {k: float(close.iloc[-1]) > v for k, v in sma.items()}}


def seasonality_score(close: pd.Series, years: int = 10, today: date | None = None) -> tuple[int, dict]:
    today = today or date.today()
    monthly = close.resample("ME").last().pct_change(fill_method=None).dropna()
    monthly = monthly[monthly.index < pd.Timestamp(today.replace(day=1))]
    same = monthly[monthly.index.month == today.month].tail(years)
    if len(same) < 5:
        return 0, {}
    avg, win = float(same.mean() * 100), float((same > 0).mean() * 100)
    if avg > 0 and win >= 70:
        s = 2
    elif avg > 0 and win >= 55:
        s = 1
    elif avg < 0 and win <= 30:
        s = -2
    elif avg < 0 and win <= 45:
        s = -1
    else:
        s = 0
    return s, {"month": today.strftime("%B"), "avg_return_pct": round(avg, 2), "win_rate_pct": round(win, 1), "years": len(same)}


# ---------- sentiment ----------

def cot_component(m: dict | None) -> int:
    return sign(m["weekly_change"]) if m else 0


def cot_score(asset: dict, cot_metrics: dict) -> tuple[int, dict]:
    if asset["kind"] == "fx":
        b, q = cot_metrics.get(CURRENCY_COT[asset["base"]]), cot_metrics.get(CURRENCY_COT[asset["quote"]])
        return cot_component(b) - cot_component(q), {asset["base"]: b, asset["quote"]: q}
    m = cot_metrics.get(asset.get("cot")) if asset.get("cot") else None
    if not m:
        return 0, {}
    return cot_component(m) + sign(m["net"]), m


def retail_score(name: str, asset: dict, retail: dict, pcr: dict) -> tuple[int, dict]:
    if asset["kind"] == "fx":
        lp = retail.get(name)
        if lp is None:
            return 0, {"source": "myfxbook", "long_pct": None}
        s = -1 if lp >= 60 else 1 if lp <= 40 else 0
        return s, {"source": "myfxbook", "long_pct": lp, "short_pct": round(100 - lp, 2)}
    sig = pcr.get(asset.get("pcr"), {})
    s = {"high_put": 2, "high_call": -1}.get(sig.get("state"), 0)
    return s, {"source": "put/call", **sig}


# ---------- fundamental ----------

def _ccy_signal(macro: dict, ccy: str, key: str) -> int:
    ind = macro.get(ccy, {}).get(key)
    if not ind or "surprise" not in ind:
        return 0
    return sign(ind["surprise"]) * ind["good_dir"]


def macro_scores(asset: dict, macro: dict) -> dict[str, int]:
    out = {}
    pol = POLARITY[asset["kind"]]
    for col, (keys, group) in MACRO_COLS.items():
        if asset["kind"] == "fx":
            k = keys[0]
            out[col] = _ccy_signal(macro, asset["base"], k) - _ccy_signal(macro, asset["quote"], k)
        else:
            out[col] = pol[group] * sum(_ccy_signal(macro, asset["econ"], k) for k in keys)
    return out


def rates_score(asset: dict, rates: dict, us2y: dict) -> int:
    if asset["kind"] == "fx":
        def r(ccy):
            return sign(rates.get(ccy, {}).get("change_6m"), eps=0.1)
        return int(np.clip(r(asset["base"]) - r(asset["quote"]), -1, 1))
    direction = {"rising": 1, "falling": -1}.get(us2y.get("state"), 0)
    return RATES_POLARITY[asset["kind"]] * direction


# ---------- assemble ----------

def bias(total: int) -> str:
    return ("Very Bullish" if total >= 8 else "Bullish" if total >= 5 else
            "Very Bearish" if total <= -8 else "Bearish" if total <= -5 else "Neutral")


def score_asset(name: str, ctx: dict) -> dict:
    a = ASSETS[name]
    cols: dict[str, int] = {}
    detail: dict = {}
    cols["COT"], detail["cot"] = cot_score(a, ctx["cot"])
    cols["Retail"], detail["retail"] = retail_score(name, a, ctx["retail"], ctx["pcr"])
    close = ctx["prices"].get(name, pd.Series(dtype=float))
    cols["Seasonality"], detail["seasonality"] = seasonality_score(close) if len(close) else (0, {})
    cols["Trend"], detail["trend"] = trend_score(close)
    cols.update(macro_scores(a, ctx["macro"]))
    cols["Rates"] = rates_score(a, ctx["rates"], ctx["us2y"])
    total = int(sum(cols.values()))
    econs = [a["base"], a["quote"]] if a["kind"] == "fx" else [a["econ"]]
    detail["macro"] = {c: ctx["macro"].get(c, {}) for c in econs}
    detail["rates"] = {c: ctx["rates"].get(c) for c in econs} | ({"US2Y": ctx["us2y"]} if a["kind"] != "fx" else {})
    return {
        "asset": name, "kind": a["kind"], "score": total, "bias": bias(total),
        "columns": {c: int(cols[c]) for c in COLUMNS},
        "groups": {g: int(sum(cols[c] for c in cs)) for g, cs in GROUPS.items()},
        "detail": detail,
    }


def score_all(ctx: dict) -> list[dict]:
    rows = [score_asset(n, ctx) for n in ASSETS]
    return sorted(rows, key=lambda r: r["score"], reverse=True)
