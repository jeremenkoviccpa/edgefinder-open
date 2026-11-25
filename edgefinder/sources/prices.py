"""Daily closes from Yahoo Finance (yfinance). Cached on disk for 6 hours."""
import time

import pandas as pd
import yfinance as yf

from ..config import DATA_DIR

CACHE = DATA_DIR / "prices"
CACHE.mkdir(exist_ok=True)
MAX_AGE = 6 * 3600


def history(ticker: str, years: int = 12) -> pd.Series:
    path = CACHE / f"{ticker.replace('^', '_').replace('=', '_')}.csv"
    if path.exists() and time.time() - path.stat().st_mtime < MAX_AGE:
        s = pd.read_csv(path, index_col=0, parse_dates=True).iloc[:, 0]
        return s.dropna()
    df = yf.download(ticker, period=f"{years}y", interval="1d", auto_adjust=True,
                     progress=False, threads=False)
    if df is None or df.empty:
        if path.exists():  # stale cache beats nothing
            return pd.read_csv(path, index_col=0, parse_dates=True).iloc[:, 0].dropna()
        return pd.Series(dtype=float)
    close = df["Close"]
    if isinstance(close, pd.DataFrame):
        close = close.iloc[:, 0]
    close = close.dropna().rename(ticker)
    close.to_csv(path)
    return close
