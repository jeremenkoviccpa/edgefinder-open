"""Headlines from Google News RSS (public, no key)."""
import re
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from urllib.parse import quote_plus

import requests

from ..config import HTTP_HEADERS

RSS = "https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"

GEO_KEYWORDS = {"nuclear": 3, "missile": 2, "war": 2, "attack": 2, "invasion": 3, "airstrike": 2,
                "sanction": 1, "crisis": 1, "conflict": 1, "tariff": 1, "coup": 2, "blockade": 2}
GEO_QUERY = "war OR missile OR sanctions OR nuclear OR attack OR invasion OR conflict when:1d"
MARKET_QUERY = '"stock market" OR forex OR "gold price" OR "oil price" OR "Federal Reserve" OR "treasury yields" when:1d'


def headlines(query: str, limit: int = 60) -> list[dict]:
    r = requests.get(RSS.format(q=quote_plus(query)), headers=HTTP_HEADERS, timeout=30)
    r.raise_for_status()
    items = []
    seen = set()
    for it in ET.fromstring(r.content).iter("item"):
        title = (it.findtext("title") or "").strip()
        source = (it.findtext("source") or "").strip()
        if source and title.endswith(f" - {source}"):
            title = title[: -len(source) - 3]
        key = title.lower()[:80]
        if not title or key in seen:
            continue
        seen.add(key)
        pub = it.findtext("pubDate")
        items.append({"title": title, "source": source, "link": it.findtext("link"),
                      "published": parsedate_to_datetime(pub).isoformat() if pub else None})
        if len(items) >= limit:
            break
    return items


def keyword_risk(items: list[dict]) -> dict:
    """A1's documented method: scan headlines for warning terms."""
    hits: dict[str, int] = {}
    weighted = 0
    for it in items:
        t = it["title"].lower()
        for kw, w in GEO_KEYWORDS.items():
            if re.search(rf"\b{kw}", t):
                hits[kw] = hits.get(kw, 0) + 1
                weighted += w
    # the query already selects for these terms, so ~1 hit/headline is "normal";
    # 3.5 weight-points per headline (multiple severe terms each) is "severe"
    score = min(100, round(weighted / max(len(items), 1) / 3.5 * 100))
    return {"score": score, "hits": hits, "n_headlines": len(items)}
