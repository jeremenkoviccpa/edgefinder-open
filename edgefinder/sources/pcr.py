"""Put/call ratio from listed-option open interest (A1: "outstanding puts /
outstanding calls", 5-day MA, std-dev thresholds).

Free sources only give the *current* option chain, so we snapshot once per day
and build our own history. Thresholds need ~20 snapshots before they score.
"""
from datetime import date, datetime, timedelta

import pandas as pd
import yfinance as yf

from ..db import conn

MAX_DAYS_OUT = 45
MAX_EXPIRIES = 8


def snapshot(etf: str) -> dict | None:
    t = yf.Ticker(etf)
    expiries = t.options
    if not expiries:
        return None
    horizon = date.today() + timedelta(days=MAX_DAYS_OUT)
    chosen = ([e for e in expiries if datetime.strptime(e, "%Y-%m-%d").date() <= horizon] or list(expiries[:1]))[:MAX_EXPIRIES]
    puts = calls = 0.0
    for e in chosen:
        ch = t.option_chain(e)
        puts += float(ch.puts["openInterest"].fillna(0).sum())
        calls += float(ch.calls["openInterest"].fillna(0).sum())
    if calls <= 0:
        return None
    row = dict(etf=etf, date=date.today().isoformat(), put_oi=puts, call_oi=calls, ratio=puts / calls)
    with conn() as c:
        c.execute("INSERT OR REPLACE INTO pcr VALUES (:etf,:date,:put_oi,:call_oi,:ratio)", row)
    return row


def signal(etf: str, k: float = 1.0, min_obs: int = 20) -> dict:
    with conn() as c:
        df = pd.read_sql("SELECT date, ratio FROM pcr WHERE etf=? ORDER BY date", c, params=(etf,))
    out = {"etf": etf, "obs": len(df), "ratio": None, "ma5": None, "high_put": None, "high_call": None, "state": "insufficient_history"}
    if df.empty:
        return out
    ma5 = df["ratio"].rolling(5, min_periods=1).mean()
    out.update(ratio=round(df["ratio"].iloc[-1], 3), ma5=round(ma5.iloc[-1], 3))
    if len(df) < min_obs:
        return out
    mu, sd = ma5.mean(), ma5.std()
    out.update(high_put=round(mu + k * sd, 3), high_call=round(mu - k * sd, 3))
    if ma5.iloc[-1] > out["high_put"]:
        out["state"] = "high_put"     # crowd fearful -> contrarian bullish
    elif ma5.iloc[-1] < out["high_call"]:
        out["state"] = "high_call"    # crowd greedy -> contrarian bearish
    else:
        out["state"] = "neutral"
    return out
