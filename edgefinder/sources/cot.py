"""CFTC Commitments of Traders — legacy futures-only report via the official
Socrata API (no key). A1 uses non-commercial (large speculator) positions."""
from datetime import date, timedelta

import pandas as pd
import requests

from ..config import HTTP_HEADERS

URL = "https://publicreporting.cftc.gov/resource/6dca-aqww.json"


def fetch(codes: list[str], weeks: int = 60) -> pd.DataFrame:
    since = (date.today() - timedelta(weeks=weeks)).isoformat()
    in_list = ",".join(f"'{c}'" for c in codes)
    params = {
        "$select": "cftc_contract_market_code AS code, report_date_as_yyyy_mm_dd AS date, "
                   "noncomm_positions_long_all AS long, noncomm_positions_short_all AS short, "
                   "open_interest_all AS oi",
        "$where": f"cftc_contract_market_code in ({in_list}) AND report_date_as_yyyy_mm_dd > '{since}'",
        "$order": "report_date_as_yyyy_mm_dd",
        "$limit": 50000,
    }
    r = requests.get(URL, params=params, headers=HTTP_HEADERS, timeout=60)
    r.raise_for_status()
    df = pd.DataFrame(r.json())
    if df.empty:
        return df
    df["date"] = pd.to_datetime(df["date"]).dt.date
    for col in ("long", "short", "oi"):
        df[col] = pd.to_numeric(df[col])
    return df


def metrics(df: pd.DataFrame, code: str) -> dict | None:
    """Long %, weekly change in long % (A1's 'latest buys/sells'), net position,
    and 13-week change (A1's 'quarterly change')."""
    d = df[df["code"] == code].sort_values("date")
    if len(d) < 2:
        return None
    long_pct = d["long"] / (d["long"] + d["short"]) * 100
    last, prev = d.iloc[-1], d.iloc[-2]
    return {
        "date": str(last["date"]),
        "long": int(last["long"]),
        "short": int(last["short"]),
        "net": int(last["long"] - last["short"]),
        "long_pct": round(float(long_pct.iloc[-1]), 2),
        "weekly_change": round(float(long_pct.iloc[-1] - long_pct.iloc[-2]), 2),
        "quarterly_change": round(float(long_pct.iloc[-1] - long_pct.iloc[-14]), 2) if len(d) >= 14 else None,
        "net_change": int((last["long"] - last["short"]) - (prev["long"] - prev["short"])),
    }
