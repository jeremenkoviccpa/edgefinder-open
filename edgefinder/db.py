"""Tiny SQLite store. Some signals (PCR thresholds, economic forecasts) only
exist as point-in-time snapshots, so we have to accumulate our own history."""
import json
import sqlite3
from contextlib import contextmanager

from .config import DATA_DIR

DB_PATH = DATA_DIR / "edgefinder.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS pcr (etf TEXT, date TEXT, put_oi REAL, call_oi REAL, ratio REAL,
    PRIMARY KEY (etf, date));
CREATE TABLE IF NOT EXISTS ff_events (title TEXT, country TEXT, date TEXT, impact TEXT,
    forecast TEXT, previous TEXT, seen_at TEXT, PRIMARY KEY (title, country, date));
CREATE TABLE IF NOT EXISTS retail (symbol TEXT, date TEXT, long_pct REAL, source TEXT,
    PRIMARY KEY (symbol, date, source));
CREATE TABLE IF NOT EXISTS scores (date TEXT, asset TEXT, total INTEGER, payload TEXT,
    PRIMARY KEY (date, asset));
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
"""


@contextmanager
def conn():
    c = sqlite3.connect(DB_PATH)
    c.executescript(SCHEMA)
    try:
        yield c
        c.commit()
    finally:
        c.close()


def put_kv(key: str, value, updated_at: str):
    with conn() as c:
        c.execute("INSERT OR REPLACE INTO kv VALUES (?,?,?)", (key, json.dumps(value, default=str), updated_at))


def get_kv(key: str, default=None):
    with conn() as c:
        row = c.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
    return json.loads(row[0]) if row else default
