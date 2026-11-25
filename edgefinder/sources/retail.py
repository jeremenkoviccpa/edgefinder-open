"""Retail FX positioning via Myfxbook's official API (free account required).

A1's FX retail column shows whole-number percentages (70/30, 69/31...), which
matches Myfxbook Community Outlook. Their non-FX rows show 2-decimal numbers
and broker market names ("UK100", "Iron Ore", "CHINA50") that look like IG
Client Sentiment — IG's REST API needs an IG account + API key, so it's not
wired up here.
"""
from datetime import date

import requests

from ..config import HTTP_HEADERS, MYFXBOOK_EMAIL, MYFXBOOK_PASSWORD
from ..db import conn

API = "https://www.myfxbook.com/api"


def fetch_myfxbook() -> dict[str, float]:
    if not (MYFXBOOK_EMAIL and MYFXBOOK_PASSWORD):
        return {}
    s = requests.Session()
    s.headers.update(HTTP_HEADERS)
    login = s.get(f"{API}/login.json", params={"email": MYFXBOOK_EMAIL, "password": MYFXBOOK_PASSWORD}, timeout=30).json()
    if login.get("error"):
        raise RuntimeError(f"Myfxbook login failed: {login.get('message')}")
    session = login["session"]
    try:
        data = s.get(f"{API}/get-community-outlook.json", params={"session": session}, timeout=30).json()
    finally:
        s.get(f"{API}/logout.json", params={"session": session}, timeout=30)
    out = {sym["name"].upper(): float(sym["longPercentage"]) for sym in data.get("symbols", [])}
    today = date.today().isoformat()
    with conn() as c:
        c.executemany("INSERT OR REPLACE INTO retail VALUES (?,?,?,?)",
                      [(k, today, v, "myfxbook") for k, v in out.items()])
    return out


def latest() -> dict[str, float]:
    with conn() as c:
        rows = c.execute(
            "SELECT symbol, long_pct FROM retail r WHERE date=(SELECT max(date) FROM retail WHERE symbol=r.symbol)"
        ).fetchall()
    return {s: v for s, v in rows}
