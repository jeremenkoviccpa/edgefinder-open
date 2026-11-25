"""AAII weekly investor sentiment survey (published spreadsheet)."""
import io

import pandas as pd
import requests

from ..config import HTTP_HEADERS

URL = "https://www.aaii.com/files/surveys/sentiment.xls"


def fetch(weeks: int = 104) -> pd.DataFrame:
    r = requests.get(URL, headers=HTTP_HEADERS, timeout=60)
    r.raise_for_status()
    raw = pd.read_excel(io.BytesIO(r.content), sheet_name="SENTIMENT", header=None)
    raw = raw[pd.to_datetime(raw[0], errors="coerce", format="mixed").notna()]
    df = pd.DataFrame({
        "date": pd.to_datetime(raw[0]).dt.date,
        "bullish": pd.to_numeric(raw[1], errors="coerce"),
        "neutral": pd.to_numeric(raw[2], errors="coerce"),
        "bearish": pd.to_numeric(raw[3], errors="coerce"),
    }).dropna()
    df["spread"] = df["bullish"] - df["bearish"]
    return df.tail(weeks).reset_index(drop=True)


def summary(df: pd.DataFrame) -> dict:
    last = df.iloc[-1]
    mu, sd = df["spread"].mean(), df["spread"].std()
    z = (last["spread"] - mu) / sd if sd else 0.0
    return {
        "date": str(last["date"]),
        "bullish": round(last["bullish"] * 100, 1),
        "neutral": round(last["neutral"] * 100, 1),
        "bearish": round(last["bearish"] * 100, 1),
        "spread": round(last["spread"] * 100, 1),
        "spread_z": round(float(z), 2),
        # contrarian: extreme bullishness is bearish for stocks, and vice versa
        "contrarian": "bearish" if z > 1.5 else "bullish" if z < -1.5 else "neutral",
    }
