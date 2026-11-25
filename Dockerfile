FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.11.14 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY edgefinder ./edgefinder
RUN uv sync --frozen --no-dev

# Railway mounts a volume here so SQLite history (PCR, forecasts, scores) survives deploys
ENV EF_DATA_DIR=/data EF_OUTPUT_DIR=/data/output
CMD ["sh", "-c", "uv run --no-sync uvicorn edgefinder.api:app --host 0.0.0.0 --port ${PORT:-8000}"]
