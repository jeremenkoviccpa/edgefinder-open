"""Asset universe and upstream identifiers.

All CFTC contract codes and FRED series IDs below were verified against the
live APIs on 2026-11-25.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("EF_DATA_DIR", ROOT / "data"))
OUTPUT_DIR = Path(os.getenv("EF_OUTPUT_DIR", ROOT / "output"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# CFTC legacy futures-only report, non-commercial (large speculator) positions.
CURRENCY_COT = {
    "EUR": "099741", "GBP": "096742", "JPY": "097741", "AUD": "232741",
    "CAD": "090741", "CHF": "092741", "NZD": "112741", "USD": "098662",  # USD = ICE Dollar Index
}

# Display names for COT contracts (currencies by ISO code, others by asset name)
COT_LABELS = {code: ccy for ccy, code in CURRENCY_COT.items()}

# Policy-rate series on FRED (USD/EUR are official; others are OECD immediate rates).
POLICY_RATE_FRED = {
    "USD": "DFEDTARU", "EUR": "ECBDFR", "GBP": "IRSTCI01GBM156N", "JPY": "IRSTCI01JPM156N",
    "AUD": "IRSTCI01AUM156N", "CAD": "IRSTCI01CAM156N", "CHF": "IRSTCI01CHM156N",
    "NZD": "IRSTCI01NZM156N",
}

# kind: fx | index | metal | commodity | crypto
#   yf   = Yahoo Finance ticker (price history for trend + seasonality)
#   cot  = CFTC contract code (non-FX assets)
#   pcr  = US-listed ETF used as the options put/call proxy (A1 scores non-FX "retail" via PCR)
#   econ = which economy's macro data drives the asset
ASSETS: dict[str, dict] = {
    "EURUSD": dict(kind="fx", yf="EURUSD=X", base="EUR", quote="USD"),
    "GBPUSD": dict(kind="fx", yf="GBPUSD=X", base="GBP", quote="USD"),
    "USDJPY": dict(kind="fx", yf="JPY=X", base="USD", quote="JPY"),
    "AUDUSD": dict(kind="fx", yf="AUDUSD=X", base="AUD", quote="USD"),
    "NZDUSD": dict(kind="fx", yf="NZDUSD=X", base="NZD", quote="USD"),
    "USDCAD": dict(kind="fx", yf="CAD=X", base="USD", quote="CAD"),
    "USDCHF": dict(kind="fx", yf="CHF=X", base="USD", quote="CHF"),
    "EURJPY": dict(kind="fx", yf="EURJPY=X", base="EUR", quote="JPY"),
    "EURAUD": dict(kind="fx", yf="EURAUD=X", base="EUR", quote="AUD"),
    "GBPJPY": dict(kind="fx", yf="GBPJPY=X", base="GBP", quote="JPY"),
    "GBPCHF": dict(kind="fx", yf="GBPCHF=X", base="GBP", quote="CHF"),
    "AUDJPY": dict(kind="fx", yf="AUDJPY=X", base="AUD", quote="JPY"),
    "GOLD": dict(kind="metal", yf="GC=F", cot="088691", pcr="GLD", econ="USD"),
    "SILVER": dict(kind="metal", yf="SI=F", cot="084691", pcr="SLV", econ="USD"),
    "COPPER": dict(kind="commodity", yf="HG=F", cot="085692", pcr="CPER", econ="USD"),
    "USOIL": dict(kind="commodity", yf="CL=F", cot="067651", pcr="USO", econ="USD"),
    "SPX500": dict(kind="index", yf="^GSPC", cot="13874A", pcr="SPY", econ="USD"),
    "NASDAQ": dict(kind="index", yf="^NDX", cot="209742", pcr="QQQ", econ="USD"),
    "DOW": dict(kind="index", yf="^DJI", cot="124603", pcr="DIA", econ="USD"),
    "RUSSELL": dict(kind="index", yf="^RUT", cot="239742", pcr="IWM", econ="USD"),
    "NIKKEI": dict(kind="index", yf="^N225", cot="240743", pcr="EWJ", econ="JPY"),
    "DAX": dict(kind="index", yf="^GDAXI", cot=None, pcr="EWG", econ="EUR"),
    "UK100": dict(kind="index", yf="^FTSE", cot=None, pcr="EWU", econ="GBP"),
    "BTCUSD": dict(kind="crypto", yf="BTC-USD", cot="133741", pcr="IBIT", econ="USD"),
}

COT_LABELS.update({a["cot"]: name for name, a in ASSETS.items() if a.get("cot")})

# LLM (any OpenAI-compatible endpoint). Default = local Ollama, which is free.
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://localhost:11434/v1")
LLM_API_KEY = os.getenv("LLM_API_KEY", "ollama")
LLM_MODEL = os.getenv("LLM_MODEL", "hermes3:8b")

MYFXBOOK_EMAIL = os.getenv("MYFXBOOK_EMAIL")
MYFXBOOK_PASSWORD = os.getenv("MYFXBOOK_PASSWORD")

HTTP_HEADERS = {"User-Agent": "edgefinder-open/0.1 (research)"}
