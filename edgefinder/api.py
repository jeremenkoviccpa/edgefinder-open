"""HTTP API (deployed on Railway). Runs the pipeline on a schedule in-process.

Schedule mirrors A1's cadence: geo/news ~3x a day, everything daily.
Set EF_SCHEDULE_HOURS (UTC, comma-separated) to change it.
"""
import logging
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path

import pandas as pd

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from . import pipeline
from .config import ASSETS
from .db import get_kv
from .sources import prices

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("edgefinder.api")
_lock = threading.Lock()
HOURS = os.getenv("EF_SCHEDULE_HOURS", "12,17,2")  # ~7am, 12pm, 9pm US Eastern
ADMIN_TOKEN = os.getenv("EF_ADMIN_TOKEN")


def run_pipeline():
    if not _lock.acquire(blocking=False):
        log.info("pipeline already running; skip")
        return
    try:
        pipeline.run()
        log.info("pipeline finished")
    except Exception:
        log.exception("pipeline failed")
    finally:
        _lock.release()


@asynccontextmanager
async def lifespan(_app):
    sched = BackgroundScheduler(timezone="UTC")
    sched.add_job(run_pipeline, "cron", hour=HOURS, minute=5, id="pipeline")
    sched.start()
    if get_kv("latest") is None and os.getenv("EF_RUN_ON_START", "1") == "1":
        threading.Thread(target=run_pipeline, daemon=True).start()
    yield
    sched.shutdown(wait=False)


app = FastAPI(title="EdgeFinder (open data)", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("EF_CORS_ORIGINS", "*").split(","),
                   allow_methods=["GET", "POST"], allow_headers=["*"])


def _latest() -> dict:
    res = get_kv("latest")
    if not res:
        raise HTTPException(503, "No data yet — first pipeline run in progress, retry in a few minutes.")
    return res


@app.get("/api/health")
def health():
    res = get_kv("latest")
    return {"ok": True, "has_data": res is not None, "generated_at": res and res["generated_at"],
            "running": _lock.locked()}


@app.get("/api/dashboard")
def dashboard():
    return _latest()


@app.get("/api/setups")
def setups():
    res = _latest()
    return {"generated_at": res["generated_at"], "setups": res["setups"]}


@app.get("/api/scorecard/{asset}")
def scorecard(asset: str):
    res = _latest()
    row = next((r for r in res["setups"] if r["asset"] == asset.upper()), None)
    if not row:
        raise HTTPException(404, f"unknown asset {asset}")
    return {**row, "history": pipeline.score_history(row["asset"])}


@app.get("/api/prices/{asset}")
def price_history(asset: str, days: int = 400):
    a = ASSETS.get(asset.upper())
    if not a:
        raise HTTPException(404, f"unknown asset {asset}")
    s = prices.history(a["yf"]).tail(days + 200)
    ma = {n: s.rolling(n).mean() for n in (20, 50, 200)}
    s = s.tail(days)
    return {"asset": asset.upper(), "points": [
        {"date": d.date().isoformat(), "close": round(float(v), 6),
         **{f"ma{n}": (None if pd.isna(m.loc[d]) else round(float(m.loc[d]), 6)) for n, m in ma.items()}}
        for d, v in s.items()]}


@app.post("/api/refresh")
def refresh(x_admin_token: str | None = Header(default=None)):
    if not ADMIN_TOKEN or x_admin_token != ADMIN_TOKEN:
        raise HTTPException(403, "forbidden")
    threading.Thread(target=run_pipeline, daemon=True).start()
    return {"started": True}


# Local preview: EF_SERVE_WEB=1 serves the dashboard from this process (Vercel does this in prod).
_WEB = Path(__file__).resolve().parent.parent / "web"
if os.getenv("EF_SERVE_WEB") == "1" and _WEB.exists():
    from fastapi.staticfiles import StaticFiles
    app.mount("/", StaticFiles(directory=_WEB, html=True), name="web")
