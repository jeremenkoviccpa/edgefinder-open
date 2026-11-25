# EdgeFinder Open

An open-data rebuild of A1 Trading's **EdgeFinder**. It scores FX, indices, metals,
commodities and crypto on COT positioning, retail and options sentiment, seasonality,
trend and US macro surprises, following the rules A1 publishes. An open-weights LLM
writes the geopolitical-risk tracker, the news feed and the scorecard narratives.

See **[FINDINGS.md](FINDINGS.md)** for how the original works and where its data comes from.

```
CFTC ─┐
FRED ─┤                         ┌─ /api/dashboard ─┐
ForexFactory ─┤   pipeline     │  /api/setups     │      Vercel
Yahoo (px+opts) ─┼─► + scoring ─► SQLite ─┤  /api/scorecard  ├──► static dashboard
AAII ─┤   (Railway, 3×/day)    └──────────────────┘      (/api/* rewritten to Railway)
Google News ─┴─► open LLM (Ollama locally / Groq etc. hosted)
```

## Run locally

```bash
uv sync
cp .env.example .env          # defaults to local Ollama
uv run ef run                 # fetch + score + LLM digest (add --no-llm to skip the LLM)
uv run ef show                # last Top Setups table
uv run ef show GOLD           # one asset's scorecard detail
uv run ef serve               # API on :8000 (plus the scheduler)
cd web && python3 -m http.server 3000   # dashboard; point /api at :8000 or use Vercel
```

A no-LLM run takes about 30 seconds. With hermes3:8b on CPU, the digest takes several
minutes; on a hosted open model it takes seconds and costs well under $1/month at 3 runs a day.

## Cheap LLM options (all OpenAI-compatible: set `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`)

| Option | Cost | Notes |
|---|---|---|
| Ollama (local) | free | best for dev; slow on CPU |
| Groq | cents/month at this volume | very fast Llama/Qwen/gpt-oss models |
| OpenRouter / DeepInfra / Together | cents/month | wide choice of open models |

Each run sends about 10–15k tokens: 2 headline digests plus 6 short narratives.

## Deploy

- **Railway** (backend): `Dockerfile` + `railway.json`. Mount a volume at `/data` so the
  SQLite history survives redeploys. Set the LLM env vars (and optionally `FRED_API_KEY`,
  `MYFXBOOK_*`, `EF_ADMIN_TOKEN`).
- **Vercel** (frontend): deploy `web/`. `web/vercel.json` rewrites `/api/*` to the Railway domain.

Informational only — not financial advice.
