"""Fetch every source, score every asset, run the LLM digest, persist results."""
import json
import logging
import time
from datetime import date, datetime, timezone

from . import digest, llm, scoring
from .config import ASSETS, COT_LABELS, CURRENCY_COT, OUTPUT_DIR
from .db import conn, get_kv, put_kv
from .sources import aaii, cot, macro, pcr, prices, retail

log = logging.getLogger("edgefinder")


def _step(status: dict, name: str, fn, default=None):
    t0 = time.time()
    try:
        val = fn()
        status[name] = {"ok": True, "secs": round(time.time() - t0, 1)}
        return val
    except Exception as e:
        log.exception("source %s failed", name)
        status[name] = {"ok": False, "error": f"{type(e).__name__}: {e}"[:300]}
        return default


def build_context(status: dict) -> dict:
    codes = sorted(set(CURRENCY_COT.values()) | {a["cot"] for a in ASSETS.values() if a.get("cot")})
    cot_df = _step(status, "cftc_cot", lambda: cot.fetch(codes))
    cot_metrics = {c: cot.metrics(cot_df, c) for c in codes} if cot_df is not None and not cot_df.empty else {}

    px = {}
    def load_prices():
        for name, a in ASSETS.items():
            s = prices.history(a["yf"])
            if len(s):
                px[name] = s
        if not px:
            raise RuntimeError("no price history returned")
    _step(status, "yahoo_prices", load_prices)

    def load_pcr():
        for etf in sorted({a["pcr"] for a in ASSETS.values() if a.get("pcr")}):
            pcr.snapshot(etf)
        return {etf: pcr.signal(etf) for etf in {a["pcr"] for a in ASSETS.values() if a.get("pcr")}}
    pcr_sig = _step(status, "options_pcr", load_pcr, {})

    _step(status, "myfxbook_retail", retail.fetch_myfxbook)
    retail_now = retail.latest()

    _step(status, "forexfactory_forecasts", macro.snapshot_ff)
    us = _step(status, "fred_macro", macro.us_indicators, {})
    us2y = _step(status, "fred_us2y", macro.us_2y_trend, {})
    rates = _step(status, "fred_policy_rates", macro.policy_rates, {})

    aaii_df = _step(status, "aaii", aaii.fetch)
    aaii_sum = aaii.summary(aaii_df) if aaii_df is not None and len(aaii_df) else None

    return {"cot": cot_metrics, "prices": px, "pcr": pcr_sig, "retail": retail_now,
            "macro": {"USD": us}, "us2y": us2y, "rates": rates, "aaii": aaii_sum,
            "aaii_history": aaii_df.tail(52).assign(date=lambda d: d["date"].astype(str)).to_dict("records") if aaii_df is not None else []}


def run(with_llm: bool = True, narrate_top: int = 6) -> dict:
    started = datetime.now(timezone.utc)
    status: dict = {}
    ctx = build_context(status)
    rows = scoring.score_all(ctx)

    today = date.today().isoformat()
    with conn() as c:
        prev = dict(c.execute(
            "SELECT asset, total FROM scores s WHERE date=(SELECT max(date) FROM scores WHERE asset=s.asset AND date<?)",
            (today,)).fetchall())
        for r in rows:
            r["day_change"] = r["score"] - prev[r["asset"]] if r["asset"] in prev else 0
        c.executemany("INSERT OR REPLACE INTO scores VALUES (?,?,?,?)",
                      [(today, r["asset"], r["score"], json.dumps(r, default=str)) for r in rows])

    llm_ok = with_llm and llm.available()
    status["llm"] = {"ok": llm_ok, "model": llm.LLM_MODEL, "base_url": llm.LLM_BASE_URL}
    geo, feed = get_kv("geo_risk"), get_kv("market_news")
    if llm_ok:
        geo = _step(status, "digest_geo_risk", digest.geo_risk, geo)
        feed = _step(status, "digest_news", digest.market_news, feed)
        strongest = sorted(rows, key=lambda r: abs(r["score"]), reverse=True)[:narrate_top]
        for r in strongest:
            r["narrative"] = digest.narrate(r)
    elif with_llm:
        log.warning("LLM endpoint %s unreachable; skipping digest", llm.LLM_BASE_URL)

    finished = datetime.now(timezone.utc).isoformat(timespec="seconds")
    if geo:
        geo.setdefault("updated_at", finished)
        put_kv("geo_risk", geo, finished)
        _append_geo_history(geo["score"], finished)
    if feed:
        put_kv("market_news", feed, finished)

    result = {
        "generated_at": finished, "started_at": started.isoformat(timespec="seconds"),
        "sources": status, "setups": rows, "aaii": ctx["aaii"], "aaii_history": ctx["aaii_history"],
        "us2y": ctx["us2y"], "rates": ctx["rates"], "macro": ctx["macro"],
        "cot": {k: v for k, v in ctx["cot"].items() if v},
        "cot_list": sorted(({"label": COT_LABELS.get(k, k), "code": k, **v} for k, v in ctx["cot"].items() if v),
                           key=lambda x: x["long_pct"]),
        "pcr": ctx["pcr"], "pcr_history": pcr_history(),
        "retail": ctx["retail"],
        "geo_risk": geo, "geo_history": get_kv("geo_history", []), "news": feed,
    }
    put_kv("latest", result, finished)
    (OUTPUT_DIR / "dashboard.json").write_text(json.dumps(result, indent=2, default=str))
    return result


def _append_geo_history(score: int, ts: str, keep: int = 400):
    hist = get_kv("geo_history", [])
    hist.append({"ts": ts, "score": score})
    put_kv("geo_history", hist[-keep:], ts)


def pcr_history(days: int = 180) -> dict[str, list]:
    with conn() as c:
        rows = c.execute("SELECT etf, date, ratio FROM pcr ORDER BY etf, date").fetchall()
    out: dict[str, list] = {}
    for etf, d, ratio in rows:
        out.setdefault(etf, []).append({"date": d, "ratio": round(ratio, 4)})
    for etf, pts in out.items():
        for i, p in enumerate(pts):
            win = [q["ratio"] for q in pts[max(0, i - 4): i + 1]]
            p["ma5"] = round(sum(win) / len(win), 4)
        out[etf] = pts[-days:]
    return out


def score_history(asset: str, days: int = 365) -> list[dict]:
    with conn() as c:
        rows = c.execute("SELECT date, total FROM scores WHERE asset=? ORDER BY date DESC LIMIT ?", (asset, days)).fetchall()
    return [{"date": d, "score": s} for d, s in reversed(rows)]
