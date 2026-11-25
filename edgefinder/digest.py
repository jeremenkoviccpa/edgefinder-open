"""LLM "digest" layer — the parts of EdgeFinder that are text, not numbers:
geopolitical risk tracker, AI news feed, scorecard narrative.

Prompts are kept small (headline titles only, compact score JSON) so an
8B open model handles them and hosted cost stays at fractions of a cent.
"""
import json

from . import llm
from .sources import news

GEO_SYSTEM = """You are a geopolitical risk analyst for a trading desk.
Given numbered news headlines from the last 24h, rate market-relevant geopolitical risk.
Return JSON only:
{"score": <0-100 integer; 0 calm, 50 normal background tension, 80+ severe market-moving danger>,
 "level": "low"|"moderate"|"elevated"|"severe",
 "events": [{"region": str, "summary": <one sentence>, "severity": <1-5>,
             "assets": [<affected markets, e.g. "USOIL","GOLD","SPX500","EURUSD">], "headline_ids": [int]}]}
Group duplicate headlines into one event. At most 6 events, most severe first. Ignore non-geopolitical items."""

NEWS_SYSTEM = """You are a markets editor. Given numbered headlines from the last 24h,
write a short market news feed. Return JSON only:
{"items": [{"title": <max 10 words>, "summary": <1-2 sentences, facts from the headlines only, no invented numbers>,
            "assets": [<affected markets from: EURUSD,GBPUSD,USDJPY,AUDUSD,USDCAD,USDCHF,NZDUSD,GOLD,SILVER,USOIL,COPPER,SPX500,NASDAQ,DOW,RUSSELL,NIKKEI,DAX,UK100,BTCUSD>],
            "tone": "bullish"|"bearish"|"neutral"}]}
At most 6 items, most market-relevant first. Merge duplicates."""

NARRATE_SYSTEM = """You explain a quantitative trading scorecard in plain English.
Given an asset's score breakdown as JSON, write 2-3 sentences: what drives the bias, and what conflicts with it.
Use only numbers present in the JSON. No advice, no price targets. Return JSON only: {"narrative": str}"""


def _numbered(items: list[dict], n: int) -> str:
    return "\n".join(f"{i}. {it['title']} ({it['source']})" for i, it in enumerate(items[:n]))


def geo_risk() -> dict:
    items = news.headlines(news.GEO_QUERY, limit=60)
    kw = news.keyword_risk(items)
    out = {"keyword": kw, "llm": None, "score": kw["score"], "headlines": items[:40]}
    try:
        res = llm.chat_json(GEO_SYSTEM, _numbered(items, 40))
        llm_score = max(0, min(100, int(res.get("score", kw["score"]))))
        out["llm"] = res
        # blend: LLM reads context ("war ends" != "war starts"); keywords keep it anchored
        out["score"] = round(0.6 * llm_score + 0.4 * kw["score"])
    except Exception as e:
        out["llm_error"] = str(e)
    out["level"] = ("severe" if out["score"] >= 80 else "elevated" if out["score"] >= 60 else
                    "moderate" if out["score"] >= 35 else "low")
    return out


def market_news() -> dict:
    items = news.headlines(news.MARKET_QUERY, limit=50)
    out = {"headlines": items[:40], "items": []}
    try:
        out["items"] = llm.chat_json(NEWS_SYSTEM, _numbered(items, 40)).get("items", [])
    except Exception as e:
        out["llm_error"] = str(e)
    return out


def narrate(row: dict) -> str | None:
    compact = {
        "asset": row["asset"], "score": row["score"], "bias": row["bias"],
        "columns": {k: v for k, v in row["columns"].items() if v},
        "groups": row["groups"],
        "trend": row["detail"].get("trend", {}).get("above_sma"),
        "seasonality": row["detail"].get("seasonality"),
    }
    try:
        return llm.chat_json(NARRATE_SYSTEM, json.dumps(compact), max_tokens=300).get("narrative")
    except Exception:
        return None
