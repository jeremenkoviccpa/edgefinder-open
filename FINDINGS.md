# EdgeFinder (a1trading.com) — reverse-engineering findings

Investigated 2026-11-25 from public pages only (marketing site, feature/methodology
pages, members-portal shell, published screenshots). No paid access was used and
no access controls were bypassed.

## 1. What the product actually is

| Layer | What it is | Evidence |
|---|---|---|
| Website / checkout | WordPress (Oxygen builder, SiteGround host), JotForm checkout | page source, `wp-json`, `form.jotform.com` links |
| **The "app"** | **Google Looker Studio (Data Studio) reports**, shared to each buyer's Google account | `/portal/` embeds `datastudio.google.com/embed/reporting/5474c626-…` (EdgeFinder) and `6928084a-…` (StockBox); portal text: *"If you see a 'Can't access report' error, ensure you are logged into your authorized Google account"*, *"Connecting to Google Data Studio…"* |
| Free dashboards | More Looker Studio reports (COT, AAII, GDP) | `lookerstudio.google.com/embed/reporting/cfd37bd1-…`, `33b34625-…`, `3653e7d4-…` |
| Economic calendar | **Investing.com** embeddable widget | `sslecal2.investing.com?...` iframe + *"Real Time Economic Calendar provided by Investing.com"* |
| Charts / market overview | **TradingView** widgets | `widgets.tradingview-widget.com/w/en/tv-market-overview.js` |
| AI news feed | LLM-written summaries, rendered into the WordPress portal page | headline + 2-sentence summaries in portal HTML |
| Pricing | A published Google Sheet (CSV) drives prices on the site | `docs.google.com/spreadsheets/d/e/2PACX-…/pub?output=csv` |

So the backend is almost certainly **scheduled scripts → Google Sheets/BigQuery → Looker Studio**.
Looker reports have no API of their own; there's no "secret A1 API" to find. Their edge is in
the scoring rules, which they publish.

## 2. Where each data series comes from

| EdgeFinder module | Most likely upstream | Confidence | Free/official replacement used here |
|---|---|---|---|
| COT (net positioning, weekly change) | CFTC Commitments of Traders, legacy report, non-commercials | **Stated** on their COT page | CFTC Socrata API `publicreporting.cftc.gov/resource/6dca-aqww` |
| Retail sentiment, FX | Myfxbook Community Outlook (whole-number %s like 70/30, 69/31 in their screenshots) | Inferred | Myfxbook official API (free account) |
| Retail sentiment, indices/commodities | Broker client-sentiment feed. Market names "UK100", "Iron Ore", "CHINA50" with 2-decimal %s match IG Client Sentiment | Inferred | Not wired (IG API needs an IG account). Scored via put/call instead, as A1 does |
| Put/call ratio | Options open interest, puts ÷ calls, 5-day MA, std-dev bands | **Stated** methodology; source not named | Yahoo option chains for ETF proxies (SPY, QQQ, GLD…), snapshotted daily |
| AAII sentiment | AAII weekly survey | **Stated** | `aaii.com/files/surveys/sentiment.xls` |
| Economic actual / forecast / surprise | An economic calendar with consensus. They embed Investing.com's, so most likely Investing.com (or ForexFactory) | Inferred | Actuals: FRED. Consensus: ForexFactory weekly JSON feed, stored daily |
| US 2Y yield (21-day SMA) | Treasury / FRED `DGS2` | Inferred | FRED |
| Interest rates / carry | Central-bank policy rates | Inferred | FRED (`DFEDTARU`, `ECBDFR`, OECD `IRSTCI01*`) |
| Trend & seasonality | Daily OHLC. Looker + Sheets suggests Sheets `GOOGLEFINANCE()` or a price API | Inferred | Yahoo Finance via `yfinance` |
| Geopolitical risk (0–100) | Keyword scan of news headlines, 3× daily (7am/12pm/9pm ET) | **Stated** | Google News RSS + keyword scan + LLM |
| AI news feed | Headlines summarised by an LLM | Evident | Google News RSS + open-weights LLM |

## 3. Published scoring rules (re-implemented in `edgefinder/scoring.py`)

- **Total score** = sum of column scores. **≥ +5 bullish, ≤ −5 bearish** (Top Setups); the score-history indicator uses ±4.
- **COT, FX pair:** sign(Δ long % week-over-week) for the base currency, minus the same for the quote currency → −2…+2.
- **COT, other assets:** sign(Δ long %) + sign(net position) → −2…+2.
- **Retail, FX:** ≥ 60 % long → −1, ≤ 40 % long → +1 (contrarian).
- **Retail, non-FX = put/call ratio:** 5-day MA above the high-put band → **+2**; below the high-call band → **−1** (deliberately asymmetric because of the upward drift in risk assets).
- **Trend:** 3-SMA vs 14-SMA cross gives ±2, pulled 1 toward zero when the 14-SMA slope disagrees.
- **Seasonality:** current-month historical tendency, −2…+2.
- **GDP, retail sales:** actual vs forecast, ±1 per economy. For FX, base minus quote. Gold is inverted.
- **PMI:** change vs previous print (not vs forecast).
- **CPI/PPI/PCE:** for FX, hotter than forecast is bullish for that currency. For indices and BTC, *cooler* CPI is +1 and cooler core CPI another +1. For gold, cooler is bullish. For commodities, hotter is bullish.
- **Labour:** NFP beat → currency/indices bullish, gold bearish; lower unemployment likewise.
- **Asset Scorecard:** groups into Technical (4H/D trend, seasonality, 20/50/100/200 SMA), Sentiment + COT, and Fundamentals (growth, inflation, jobs).

## 4. Gaps in this open version

1. **Non-US macro.** FRED has the US actuals and ForexFactory has every country's consensus, but
   nothing free and official provides actuals for EUR/GBP/JPY/AUD/CAD/CHF/NZD together with
   their forecasts. Options: (a) a paid calendar API (Financial Modeling Prep, Trading Economics,
   EODHD), or (b) DBnomics (free; Eurostat/ONS/ABS/StatCan) plus the stored ForexFactory forecasts.
   Until then, the non-US half of FX macro scores 0.
2. **PMIs** aren't on FRED (ISM data was removed). Same fix as (1).
3. **Put/call bands** need about 20 daily snapshots before they score. Free sources give no history.
4. **ForexFactory forecasts** only exist for the current week, so surprise-vs-forecast appears only
   for releases that happen while the pipeline is running. Older prints fall back to vs-previous.
5. **Retail sentiment for indices/commodities** (IG) isn't wired up. Put/call covers those, as in A1's own scoring.
