/* EdgeFinder Open — dashboard. Layout modeled on Looker Studio-style trading reports. */
"use strict";

const API = "/api";
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sgn = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
const plus = (v) => (v == null ? "" : v >= 0 ? `+${v}` : `${v}`);
const cellCls = (v) => (v == null ? "" : v > 0 ? "c-pos" : v < 0 ? "c-neg" : "c-zero");
const C = { blue: "#3442c4", blue2: "#5b8def", red: "#ee5a5b", grey: "#bdbdbd", text: "#c9c9cf", grid: "#3d3d44", orange: "#f5a623" };

let DATA = null;
let charts = [];

/* ---------------- static config ---------------- */
const COLS = ["Trend", "Seasonality", "COT", "Crowd Sentiment", "GDP", "mPMI", "sPMI", "Retail Sales", "Cnsmr Conf",
  "CPI YoY", "PPI MoM", "PCE MoM", "Interest Rates", "NFP", "Unemploy. Rate", "Unemploy. Claims", "ADP", "JOLTS"];
const HEAD = { "Crowd Sentiment": "Crowd<br>Sentiment", "Retail Sales": "Retail<br>Sales", "Cnsmr Conf": "Cnsmr<br>Conf",
  "Interest Rates": "Interest<br>Rates", "Unemploy. Rate": "Unemploy.<br>Rate", "Unemploy. Claims": "Unemploy.<br>Claims",
  "PPI MoM": "PPI<br>MoM", "PCE MoM": "PCE<br>MoM", "CPI YoY": "CPI YoY" };
const TIPS = {
  Trend: "3-day vs 14-day SMA crossover, adjusted by the 14-day slope (−2…+2).",
  Seasonality: "Average return and win rate for the current calendar month over the last 10 years (−2…+2).",
  COT: "CFTC non-commercial positioning: week-over-week change in long %, plus net position for non-FX (−2…+2).",
  "Crowd Sentiment": "FX: retail positioning (≥60% long = −1, ≤40% = +1). Others: put/call ratio 5-day MA vs std-dev bands (+2 / −1).",
};
const PAGES = [
  ["Scanners", [["top-setups", "Top Setups"], ["scorecard", "Asset Scorecard"], ["history", "Score History"]]],
  ["Positioning", [["cot", "COT Net Positioning"], ["cot-velocity", "COT Velocity"], ["retail", "Retail Sentiment"], ["pcr", "Put-Call Ratio"], ["aaii", "AAII Investor Sentiment"]]],
  ["Macro", [["heatmap", "US Economic Heatmap"]]],
  ["News & Risk", [["geo", "Geopolitical Risk Tracker"], ["news", "AI News Feed"]]],
];
const KIND_LABEL = { fx: "Currencies", index: "Indices", metal: "Metals", commodity: "Commodities", crypto: "Crypto" };
const PCR_ASSETS = ["SPX500", "NASDAQ", "DOW", "RUSSELL", "GOLD", "SILVER", "USOIL", "COPPER", "NIKKEI", "DAX", "UK100", "BTCUSD"];
const ASSET_PCR = { SPX500: "SPY", NASDAQ: "QQQ", DOW: "DIA", RUSSELL: "IWM", GOLD: "GLD", SILVER: "SLV", USOIL: "USO", COPPER: "CPER", NIKKEI: "EWJ", DAX: "EWG", UK100: "EWU", BTCUSD: "IBIT" };
const MACRO_GROUPS = [
  ["Economic growth", "growth", [["gdp", "GDP Growth QoQ"], ["mpmi", "Manufacturing PMIs"], ["spmi", "Services PMIs"], ["retail_sales", "Retail Sales MoM"], ["consumer_sent", "Consumer Confidence"]]],
  ["Inflation", "inflation", [["cpi_yoy", "CPI YoY"], ["core_cpi_mom", "Core CPI MoM"], ["ppi_mom", "PPI MoM"], ["core_pce_mom", "Core PCE MoM"]]],
  ["Jobs market", "labor", [["nfp", "Non-Farm Payroll"], ["unemployment", "Unemployment Rate %"], ["claims", "Weekly Jobless Claims"], ["adp", "ADP Employment Change"], ["jolts", "JOLTS Job Openings"]]],
];
const POLARITY = {
  fx: { growth: 1, inflation: 1, labor: 1 }, index: { growth: 1, inflation: -1, labor: 1 }, crypto: { growth: 1, inflation: -1, labor: 1 },
  metal: { growth: -1, inflation: -1, labor: -1 }, commodity: { growth: 1, inflation: 1, labor: 1 },
};
const DISCLAIMER = "Readings are generated from public data for informational purposes only and do not constitute financial advice.";

/* ---------------- helpers ---------------- */
function biasClass(b) {
  return { "Very Bullish": "bg-vbull", Bullish: "bg-bull", Neutral: "bg-neu", Bearish: "bg-bear", "Very Bearish": "bg-vbear" }[b] || "bg-neu";
}
function biasWord(v) { return v > 0 ? "Bullish" : v < 0 ? "Bearish" : "Neutral"; }
function groupBias(v) { return v >= 3 ? "Very Bullish" : v > 0 ? "Bullish" : v <= -3 ? "Very Bearish" : v < 0 ? "Bearish" : "Neutral"; }
function rowTint(score) {
  if (score >= 5) return "#3442c4";
  if (score <= -5) return "#ee5a5b";
  if (score > 0) return ["#45476a", "#424680", "#3f4590", "#3b44a3"][Math.min(score, 4) - 1];
  if (score < 0) return ["#6b4a4f", "#7d4c50", "#914f52", "#a75254"][Math.min(-score, 4) - 1];
  return "#4a4a50";
}
function fmtNum(ind, v) {
  if (v == null || Number.isNaN(v)) return "—";
  if (ind.unit === "%") return `${(+v).toFixed(2)}%`;
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${Math.round(v / 1e3)}K`;
  return (+v).toFixed(1);
}
function fmtDate(s) {
  if (!s) return "—";
  const d = new Date(s.length <= 10 ? s + "T12:00:00" : s);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
}
const fmtPeriod = (ind) => {
  if (ind.release) return fmtDate(ind.release);
  const d = new Date(ind.period + "T12:00:00");
  return `${d.toLocaleDateString(undefined, { month: "short", year: "numeric" })} data`;
};
const daysAgo = (s) => (s ? (Date.now() - new Date(s.length <= 10 ? s + "T12:00:00" : s)) / 864e5 : 1e9);
const setupRow = (a) => DATA.setups.find((r) => r.asset === a);
function info(text) { return `<span class="info" tabindex="0">i<span class="tip">${text}</span></span>`; }
function header(title, opts = {}) {
  return `${opts.disclaimer ? `<p class="disclaimer">${DISCLAIMER}</p>` : ""}
  <div class="rhead"><div class="rtitle"><div><h1>${esc(title)}</h1>${opts.sub ? `<div class="sub">${esc(opts.sub)}</div>` : ""}</div>${opts.info ? info(opts.info) : ""}</div>${opts.right || ""}</div>`;
}
function select(id, label, options, value) {
  return `<div class="ctl">${label ? `<label for="${id}">${esc(label)}:</label>` : ""}<select id="${id}">${options
    .map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(value) ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></div>`;
}
function assetOptions(list) { return (list || DATA.setups.map((r) => r.asset)).map((a) => [a, a]); }

/* ---------------- gauge (SVG dial) ---------------- */
function gauge(t, { size = 220, left = "Bear", right = "Bull", top = "Neutral", title = "", value = "", leftColor = C.red, rightColor = C.blue } = {}) {
  t = Math.max(0, Math.min(1, t));
  const cx = 100, cy = 100;
  const ang = (u) => ((135 + 270 * u) * Math.PI) / 180;
  const pt = (r, u) => [cx + r * Math.cos(ang(u)), cy + r * Math.sin(ang(u))];
  const arc = (r, u0, u1) => { const [x0, y0] = pt(r, u0), [x1, y1] = pt(r, u1); return `M${x0},${y0} A${r},${r} 0 ${(u1 - u0) * 270 > 180 ? 1 : 0} 1 ${x1},${y1}`; };
  const ticks = Array.from({ length: 11 }, (_, i) => { const u = i / 10, [x0, y0] = pt(66, u), [x1, y1] = pt(i % 5 ? 72 : 76, u);
    return `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="#333" stroke-width="${i % 5 ? 1 : 2}"/>`; }).join("");
  const [nx, ny] = pt(62, t), [bx1, by1] = pt(7, t + 0.25), [bx2, by2] = pt(7, t - 0.25);
  return `<svg viewBox="0 0 200 200" width="${size}" height="${size}" role="img" aria-label="${esc(title || "gauge")} ${esc(value)}">
    <defs><radialGradient id="rim" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#e9e9e9"/><stop offset="1" stop-color="#9c9c9c"/></radialGradient></defs>
    <circle cx="100" cy="100" r="96" fill="url(#rim)"/><circle cx="100" cy="100" r="86" fill="#f4f4f4"/>
    <path d="${arc(73, 0, 0.36)}" stroke="${leftColor}" stroke-width="14" fill="none"/>
    <path d="${arc(73, 0.64, 1)}" stroke="${rightColor}" stroke-width="14" fill="none"/>
    ${ticks}
    <text x="100" y="52" text-anchor="middle" font-size="12" fill="#222">${esc(top)}</text>
    <text x="58" y="${title ? 150 : 86}" text-anchor="middle" font-size="12" fill="#222">${esc(left)}</text>
    <text x="142" y="${title ? 150 : 86}" text-anchor="middle" font-size="12" fill="#222">${esc(right)}</text>
    ${title ? `<text x="100" y="86" text-anchor="middle" font-size="22" fill="#333">${esc(title)}</text>` : ""}
    <polygon points="${nx},${ny} ${bx1},${by1} ${bx2},${by2}" fill="#e8603c" stroke="#a33" stroke-width=".6"/>
    <circle cx="100" cy="100" r="10" fill="#3b82f6" stroke="#1d4ed8"/>
    <text x="100" y="${title ? 176 : 150}" text-anchor="middle" font-size="${title ? 24 : 22}" fill="#111">${esc(value)}</text>
  </svg>`;
}

/* ---------------- Chart.js setup ---------------- */
if (window.Chart) {
  Chart.defaults.color = C.text;
  Chart.defaults.borderColor = C.grid;
  Chart.defaults.font.family = "Roboto, system-ui, sans-serif";
  Chart.defaults.plugins.legend.labels.boxWidth = 22;
  Chart.defaults.maintainAspectRatio = false;
  Chart.register({
    id: "bands",
    beforeDatasetsDraw(chart, _a, o) {
      if (!o || !o.items) return;
      const { ctx, chartArea: a, scales } = chart;
      const y = scales.y;
      ctx.save();
      for (const b of o.items) {
        if (b.gradient) {
          const g = ctx.createLinearGradient(0, a.top, 0, a.bottom);
          g.addColorStop(0, b.gradient[0]); g.addColorStop(1, b.gradient[1]);
          ctx.fillStyle = g; ctx.fillRect(a.left, a.top, a.right - a.left, a.bottom - a.top);
          continue;
        }
        const y1 = Math.max(a.top, Math.min(a.bottom, y.getPixelForValue(b.from)));
        const y2 = Math.max(a.top, Math.min(a.bottom, y.getPixelForValue(b.to)));
        ctx.fillStyle = b.color; ctx.fillRect(a.left, Math.min(y1, y2), a.right - a.left, Math.abs(y2 - y1));
      }
      ctx.restore();
    },
  });
  Chart.register({
    id: "hlines",
    afterDatasetsDraw(chart, _a, o) {
      if (!o || !o.items) return;
      const { ctx, chartArea: a, scales } = chart;
      ctx.save();
      for (const l of o.items) {
        if (l.y == null) continue;
        const py = scales.y.getPixelForValue(l.y);
        if (py < a.top || py > a.bottom) continue;
        ctx.strokeStyle = l.color; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(a.left, py); ctx.lineTo(a.right, py); ctx.stroke();
        if (l.label) {
          ctx.setLineDash([]); ctx.font = "12px Roboto"; const w = ctx.measureText(l.label).width + 6;
          ctx.fillStyle = l.color + "cc"; ctx.fillRect(a.left + 2, py - 15, w, 15);
          ctx.fillStyle = "#111"; ctx.fillText(l.label, a.left + 5, py - 3);
        }
      }
      ctx.restore();
    },
  });
}
function chart(canvas, cfg) {
  if (!window.Chart) { canvas.parentElement.innerHTML = '<div class="empty">Chart library failed to load.</div>'; return null; }
  const c = new Chart(canvas, cfg); charts.push(c); return c;
}

/* ---------------- pages ---------------- */
const state = { search: "", cat: "all", bias: "all", tech: "all", sent: "all", macro: "all", sort: "score", dir: -1 };

function pageTopSetups(el) {
  const filt = (v, f) => f === "all" || (f === "pos" ? v > 0 : f === "neg" ? v < 0 : v === 0);
  const rows = DATA.setups.filter((r) => {
    const a = r.asset, fx = r.kind === "fx", major = fx && /USD/.test(a);
    if (state.search && !a.includes(state.search.toUpperCase())) return false;
    if (state.cat !== "all" && !(state.cat === "major" ? major : state.cat === "minor" ? fx && !major : state.cat === "exminor" ? !(fx && !major) : r.kind === state.cat)) return false;
    if (state.bias === "exneutral" && r.bias === "Neutral") return false;
    if (state.bias === "bull" && !r.bias.includes("Bullish")) return false;
    if (state.bias === "bear" && !r.bias.includes("Bearish")) return false;
    return filt(r.groups.technical, state.tech) && filt(r.groups.sentiment, state.sent) && filt(r.groups.fundamental, state.macro);
  }).sort((x, y) => (state.sort === "asset" ? x.asset.localeCompare(y.asset) : x.score - y.score) * state.dir);

  const scoreFilter = [["all", "All"], ["pos", "Positive"], ["neg", "Negative"], ["zero", "Zero"]];
  el.innerHTML = header("Top Setups", {
    disclaimer: true,
    info: "Each column scores one factor; the total is their sum. A total of +5 or more is a bullish bias, −5 or less bearish. Blank cells have no data source yet. Click a symbol for its scorecard.",
    right: `<div class="controls">
      <div class="ctl input"><input id="f-search" placeholder="Symbol search" value="${esc(state.search)}" aria-label="Symbol search"></div>
      ${select("f-cat", "Category", [["all", "All"], ["exminor", "Exclude Minor Currencies"], ["major", "Major Currencies"], ["minor", "Minor Currencies"], ["index", "Indices"], ["metal", "Metals"], ["commodity", "Commodities"], ["crypto", "Crypto"]], state.cat)}
      ${select("f-bias", "Bias", [["all", "All"], ["exneutral", "Exclude Neutral"], ["bull", "Bullish"], ["bear", "Bearish"]], state.bias)}
      ${select("f-tech", "Technical Score Filter", scoreFilter, state.tech)}
      ${select("f-sent", "Sentiment + COT Score Filter", scoreFilter, state.sent)}
      ${select("f-macro", "Macro Score Filter", scoreFilter, state.macro)}
    </div>`,
  }) + `<div class="grid-wrap">
    <div class="daychg"><table class="ef"><thead><tr class="bands"><th style="background:transparent"></th></tr><tr><th style="background:transparent">1 Day<br>Change</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td class="${r.day_change > 0 ? "up" : r.day_change < 0 ? "down" : ""}">${plus(r.day_change)}</td></tr>`).join("")}</tbody></table></div>
    <table class="ef" id="grid"><thead>
      <tr class="bands"><th colspan="3" class="b-ai">EdgeFinder AI Summary</th><th colspan="4" class="b-ts">Trend &amp; Sentiment Analysis</th><th colspan="${COLS.length - 4}" class="b-mac">Macro Fundamentals / Economic Data Analysis</th></tr>
      <tr><th class="sortable" data-sort="asset" style="min-width:98px">Symbol ${state.sort === "asset" ? (state.dir > 0 ? "▴" : "▾") : ""}</th><th style="min-width:100px">Bias</th>
      <th class="sortable" data-sort="score">Score ${state.sort === "score" ? (state.dir > 0 ? "▴" : "▾") : ""}</th>
      ${COLS.map((c) => `<th title="${esc(TIPS[c] || "")}">${HEAD[c] || c}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => { const t = rowTint(r.score); return `<tr>
      <td class="sym" style="background:${t}"><a href="#/scorecard/${r.asset}">${r.asset}</a></td>
      <td style="background:${t}">${r.bias}</td><td style="background:${t}">${r.score}</td>
      ${COLS.map((c) => { const v = r.columns[c]; return `<td class="${cellCls(v)}" ${v == null ? `style="background:${t}" title="No data source yet"` : ""}>${plus(v)}</td>`; }).join("")}</tr>`; }).join("")}
    </tbody></table></div>
    ${rows.length ? "" : '<div class="empty">No symbols match these filters.</div>'}`;

  $("#f-search").oninput = (e) => { state.search = e.target.value; const pos = e.target.selectionStart; render(); const i = $("#f-search"); i.focus(); i.setSelectionRange(pos, pos); };
  for (const [id, key] of [["f-cat", "cat"], ["f-bias", "bias"], ["f-tech", "tech"], ["f-sent", "sent"], ["f-macro", "macro"]])
    $("#" + id).onchange = (e) => { state[key] = e.target.value; render(); };
  el.querySelectorAll("th.sortable").forEach((th) => (th.onclick = () => {
    const k = th.dataset.sort; state.dir = state.sort === k ? -state.dir : k === "asset" ? 1 : -1; state.sort = k; render();
  }));
}

function macroIndicatorSignal(r, ccy, key, group) {
  const ind = (r.detail.macro[ccy] || {})[key];
  if (!ind || ind.surprise == null) return null;
  const s = sgn(ind.surprise) * ind.good_dir;
  if (r.kind === "fx") return ccy === r.asset.slice(0, 3) ? s : -s;
  return POLARITY[r.kind][group] * s;
}

async function pageScorecard(el, asset) {
  asset = asset || "GOLD";
  const r = setupRow(asset);
  if (!r) { el.innerHTML = '<div class="empty">Unknown symbol.</div>'; return; }
  const d = r.detail, tr = d.trend || {}, se = d.seasonality || {}, rt = d.retail || {};
  const g = r.groups;
  const chip = (v, txt) => `<div class="chip ${v > 0 ? "bg-bull" : v < 0 ? "bg-bear" : "bg-neu"}">${txt ?? biasWord(v)}</div>`;
  const colorWord = (v) => `<span class="${v > 0 ? "t-bull" : v < 0 ? "t-bear" : "t-neu"}">${groupBias(v)}</span>`;

  // crowd sentiment text
  let crowdTxt = "No crowd-sentiment reading yet.", crowdV = r.columns["Crowd Sentiment"];
  if (rt.source === "myfxbook" && rt.long_pct != null)
    crowdTxt = `Retail traders are ${rt.long_pct.toFixed(0)}% long / ${rt.short_pct.toFixed(0)}% short. ${crowdV > 0 ? "The crowd is heavily short, giving a contrarian bullish signal." : crowdV < 0 ? "The crowd is heavily long, giving a contrarian bearish signal." : "Positioning is not extreme, so there is no contrarian signal."}`;
  else if (rt.source === "put/call")
    crowdTxt = rt.state === "insufficient_history" || !rt.state
      ? `Put/call ratio (${esc(rt.etf)} options) is ${rt.ma5 ?? "—"} (5-day MA). Thresholds need ~20 daily readings; ${rt.obs || 0} collected so far.`
      : `Put/call ratio (${esc(rt.etf)}) 5-day MA is ${rt.ma5}. ${rt.state === "high_put" ? "Puts are being bought aggressively — a contrarian bullish signal." : rt.state === "high_call" ? "Calls are being bought aggressively — a contrarian bearish signal." : "Options positioning is within normal bands."}`;

  // COT rows
  const cotEntries = r.kind === "fx" ? Object.entries(d.cot || {}).filter(([, m]) => m) : d.cot && d.cot.long_pct != null ? [[asset, d.cot]] : [];
  const cotNet = r.kind === "fx" ? null : d.cot && d.cot.net != null ? sgn(d.cot.net) : null;
  const cotWk = cotEntries.length ? (r.kind === "fx" ? r.columns.COT : sgn(d.cot.weekly_change)) : null;

  const econs = r.kind === "fx" ? [r.asset.slice(0, 3), r.asset.slice(3)] : [Object.keys(d.macro)[0]];
  const macroSections = MACRO_GROUPS.map(([title, group, inds]) => {
    const lines = []; let tot = 0;
    const missing = econs.filter((c) => !Object.keys(d.macro[c] || {}).length);
    for (const ccy of econs.filter((c) => !missing.includes(c))) for (const [key, label] of inds) {
      const ind = (d.macro[ccy] || {})[key];
      const s = macroIndicatorSignal(r, ccy, key, group);
      if (s != null) tot += s;
      lines.push(`<div class="row"><div class="lab">${econs.length > 1 || ccy !== "USD" ? `<small class="t-neu">${ccy}</small> ` : ""}${label}</div>
        ${s == null ? '<div class="chip bg-neu" style="opacity:.55">n/a</div>' : chip(s)}
        <div class="num">${ind ? fmtNum(ind, ind.actual) : "—"}</div>
        <div class="num">${ind ? (ind.forecast != null ? fmtNum(ind, ind.forecast) : `<span title="No consensus on file; compared with previous">${fmtNum(ind, ind.previous)}ᵖ</span>`) : "—"}</div>
        <div class="num ${ind ? (s > 0 ? "t-bull" : s < 0 ? "t-bear" : "") : ""}">${ind ? fmtNum(ind, ind.surprise) : "—"}</div>
        <div class="num">${ind ? esc(fmtPeriod(ind)) : "—"}</div></div>`);
    }
    const extra = group === "inflation" && d.rates && d.rates.US2Y
      ? `<div class="row"><div class="lab">US 2Y Yield (21 day SMA)</div>${chip(r.columns["Interest Rates"] ?? 0)}<div class="num" style="grid-column:span 4;text-align:left">The 2yr yield is ${esc(d.rates.US2Y.state)} (${d.rates.US2Y.sma21}%)${d.rates.US2Y.state === "rising" ? " — hawkish" : d.rates.US2Y.state === "falling" ? " — dovish" : ""}</div></div>` : "";
    if (missing.length) lines.push(`<div class="row"><div class="lab t-neu" style="font-size:14px;grid-column:1/-1">No ${missing.join("/")} macro feed yet — needs an economic-calendar provider with actuals.</div></div>`);
    return `<div class="pnl mt macro"><div class="row hdr" style="background:var(--panel-2)"><div style="font-size:19px;font-style:normal">${title}</div><div class="chip" style="background:transparent">${colorWord(tot)}</div><div class="num">Actual</div><div class="num">Forecast</div><div class="num">Surprise</div><div class="num">Date</div></div>${lines.join("")}${extra}</div>`;
  }).join("");

  el.innerHTML = header("Asset Scorecard", { disclaimer: true, sub: "Fundamentals, sentiment and technical context for one market" }) + `
  <div class="sc">
    <div>
      <div class="pnl">
        <div class="sym-pick"><span>Symbol:</span><select id="sc-sym" aria-label="Symbol">${assetOptions().map(([v]) => `<option ${v === asset ? "selected" : ""}>${v}</option>`).join("")}</select></div>
        <div class="bias-banner ${biasClass(r.bias)}">${r.bias}</div>
        <div class="gauge-wrap">${gauge((r.score + 15) / 30, { value: r.score, left: "Bear", right: "Bull", top: "Neutral" })}</div>
        <div class="rows score-rows">
          <div class="row"><div class="lab">EdgeFinder score</div>${chip(r.score, r.score)}</div>
          <div class="row"><div class="lab">Technical score</div>${chip(g.technical, g.technical)}</div>
          <div class="row"><div class="lab">Sentiment + COT score</div>${chip(g.sentiment, g.sentiment)}</div>
          <div class="row"><div class="lab">Fundamentals score</div>${chip(g.fundamental, g.fundamental)}</div>
        </div>
      </div>
      <div class="pnl mt"><div class="pnl-h" style="font-size:17px">EdgeFinder score over time</div><div class="chart-box" style="height:200px;padding:6px"><canvas id="sc-hist"></canvas></div></div>
    </div>
    <div>
      <div class="two">
        <div class="pnl"><div class="pnl-h">Technical bias ${colorWord(g.technical)}</div>
          <div class="rows">
            <div class="row" style="grid-template-columns:1fr 150px"><div class="lab">Daily Chart Trend</div>${chip(r.columns.Trend == null ? 0 : sgn(r.columns.Trend), r.columns.Trend == null ? "n/a" : null)}</div>
            <div class="row" style="grid-template-columns:1fr 150px"><div class="lab">Current Month's Seasonality</div>${chip(r.columns.Seasonality || 0, r.columns.Seasonality == null ? "n/a" : null)}</div>
            ${Object.entries(tr.above_sma || {}).map(([n, ab]) => `<div class="row" style="grid-template-columns:1fr 150px"><div class="lab">Price vs ${n} SMA</div>${chip(ab ? 1 : -1, ab ? "Above" : "Below")}</div>`).join("")}
          </div>
          ${se.month ? `<div class="note" style="padding:0 10px 10px">${esc(se.month)}: avg ${se.avg_return_pct}% · up ${se.win_rate_pct}% of the last ${se.years} years</div>` : ""}
        </div>
        <div class="pnl"><div class="pnl-h">Crowd sentiment signal ${crowdV == null ? '<span class="t-neu">n/a</span>' : colorWord(crowdV)}</div><div class="crowd">${esc(crowdTxt)}</div></div>
      </div>
      <div class="pnl mt"><div class="pnl-h">Institutional activity bias ${colorWord(r.columns.COT ?? 0)}</div>
        <div class="scroll-x"><div class="rows" style="min-width:560px">
          <div class="row" style="grid-template-columns:1.4fr 130px 1fr 1fr 1fr;color:var(--muted);font-size:14px"><div></div><div></div><div class="num">Long %</div><div class="num">Short %</div><div class="num">Latest change</div></div>
          ${cotEntries.length ? cotEntries.map(([k, m]) => `<div class="row" style="grid-template-columns:1.4fr 130px 1fr 1fr 1fr">
            <div class="lab">COT${r.kind === "fx" ? " " + esc(k) : ""} - Latest Buys/Sells</div>${chip(r.kind === "fx" && k !== r.asset.slice(0, 3) ? -sgn(m.weekly_change) : sgn(m.weekly_change))}
            <div class="num t-bull">${m.long_pct.toFixed(2)}%</div><div class="num">${(100 - m.long_pct).toFixed(2)}</div><div class="num ${m.weekly_change > 0 ? "t-bull" : "t-bear"}">${m.weekly_change.toFixed(2)}%</div></div>`).join("")
            : '<div class="row"><div class="lab t-neu">No CFTC contract for this market.</div></div>'}
          ${cotNet != null ? `<div class="row" style="grid-template-columns:1.4fr 130px 3fr"><div class="lab">COT - Net Positioning</div>${chip(cotNet)}<div class="num">${d.cot.net.toLocaleString()} contracts net · report ${esc(fmtDate(d.cot.date))}</div></div>` : ""}
        </div></div>
      </div>
      <div class="scroll-x"><div style="min-width:720px">${macroSections}</div></div>
      ${r.narrative ? `<div class="pnl mt"><div class="pnl-h">Market context (AI summary)</div><div class="narr">${esc(r.narrative)}</div></div>` : ""}
    </div>
  </div>`;
  $("#sc-sym").onchange = (e) => (location.hash = `#/scorecard/${e.target.value}`);

  try {
    const h = await (await fetch(`${API}/scorecard/${asset}`)).json();
    const pts = h.history || [];
    chart($("#sc-hist"), {
      type: "bar",
      data: { labels: pts.map((p) => p.date), datasets: [{ data: pts.map((p) => p.score), backgroundColor: "#fff", barPercentage: 0.8 }] },
      options: { plugins: { legend: { display: false }, bands: { items: [{ from: 5, to: 15, color: "#33368a" }, { from: -5, to: -15, color: "#7a3a40" }] } },
        scales: { y: { min: -15, max: 15, ticks: { stepSize: 5 } }, x: { ticks: { maxTicksLimit: 6 } } } },
    });
    if (pts.length < 2) $("#sc-hist").parentElement.insertAdjacentHTML("beforeend", '<div class="note" style="position:absolute;bottom:6px;left:10px">History grows by one point per day.</div>');
  } catch { /* keep the panel empty */ }
}

async function pageHistory(el, asset) {
  asset = asset || "GOLD";
  const today = new Date(), yearAgo = new Date(Date.now() - 365 * 864e5);
  const iso = (d) => d.toISOString().slice(0, 10);
  el.innerHTML = header(`${asset} daily chart vs. EdgeFinder Score`, { right: `<span class="note">Updated ${esc(new Date(DATA.generated_at).toLocaleString())}</span>` }) + `
  <div class="hist-grid">
    <div><div class="side-pnl">
      <label for="h-sym">Symbol</label><select id="h-sym">${assetOptions().map(([v]) => `<option ${v === asset ? "selected" : ""}>${v}</option>`).join("")}</select>
      <label>Moving Averages</label>
      ${[20, 50, 200].map((n) => `<div class="chk"><input type="checkbox" id="ma${n}" ${n === 50 ? "checked" : ""}><label for="ma${n}" style="margin:0">${n} MA</label></div>`).join("")}
      <label for="h-from">Date Range</label><input type="date" id="h-from" value="${iso(yearAgo)}"><input type="date" id="h-to" value="${iso(today)}" style="margin-top:8px">
      <button class="go" id="h-go">Update</button>
    </div>
    <div class="side-pnl mt"><b>Legend</b><div class="note" style="color:#3ddc84">▲ Bullish (score crossed 5)</div><div class="note" style="color:#ff4d5e">▼ Bearish (score crossed −5)</div></div></div>
    <div class="side-pnl"><div class="chart-box" style="height:380px"><canvas id="h-px"></canvas></div><div class="chart-box" style="height:170px;margin-top:8px"><canvas id="h-sc"></canvas></div></div>
  </div>`;
  $("#h-sym").onchange = (e) => (location.hash = `#/history/${e.target.value}`);
  let px, hist;
  try {
    [px, hist] = await Promise.all([fetch(`${API}/prices/${asset}?days=800`).then((r) => r.json()), fetch(`${API}/scorecard/${asset}`).then((r) => r.json())]);
  } catch { $("#h-px").parentElement.innerHTML = '<div class="empty">Could not load price history.</div>'; return; }
  const draw = () => {
    charts.forEach((c) => c.destroy()); charts = [];
    const from = $("#h-from").value, to = $("#h-to").value;
    const pts = px.points.filter((p) => p.date >= from && p.date <= to);
    const scoreBy = Object.fromEntries((hist.history || []).map((h) => [h.date, h.score]));
    const labels = pts.map((p) => p.date);
    const scores = labels.map((l) => scoreBy[l] ?? null);
    const bull = [], bear = [];
    let prev = null;
    labels.forEach((l, i) => { const s = scores[i]; bull.push(s != null && prev != null && s >= 5 && prev < 5 ? pts[i].close : null); bear.push(s != null && prev != null && s <= -5 && prev > -5 ? pts[i].close : null); if (s != null) prev = s; });
    const ds = [{ label: "Close", data: pts.map((p) => p.close), borderColor: "#26a69a", borderWidth: 1.6, pointRadius: 0, tension: 0 }];
    const maColors = { 20: "#c084fc", 50: "#e8e84a", 200: "#f97316" };
    for (const n of [20, 50, 200]) if ($(`#ma${n}`).checked) ds.push({ label: `${n} MA`, data: pts.map((p) => p[`ma${n}`]), borderColor: maColors[n], borderWidth: 1, pointRadius: 0 });
    ds.push({ label: "Bullish reading", data: bull, showLine: false, pointStyle: "triangle", pointRadius: 7, backgroundColor: "#3ddc84", borderColor: "#3ddc84" });
    ds.push({ label: "Bearish reading", data: bear, showLine: false, pointStyle: "triangle", rotation: 180, pointRadius: 7, backgroundColor: "#ff4d5e", borderColor: "#ff4d5e" });
    chart($("#h-px"), { type: "line", data: { labels, datasets: ds }, options: { interaction: { mode: "index", intersect: false }, plugins: { legend: { position: "right" } }, scales: { x: { ticks: { maxTicksLimit: 8 } } } } });
    chart($("#h-sc"), { type: "line", data: { labels, datasets: [{ label: "Score", data: scores, borderColor: "#4da3ff", pointRadius: 2, spanGaps: true }] },
      options: { plugins: { legend: { position: "right" }, hlines: { items: [{ y: 5, color: "#22c55e" }, { y: -5, color: "#ef4444" }, { y: 0, color: "#ffffff" }] } }, scales: { y: { suggestedMin: -15, suggestedMax: 15 }, x: { ticks: { maxTicksLimit: 8 } } } } });
    if (!(hist.history || []).length || (hist.history || []).length < 2)
      $("#h-sc").parentElement.insertAdjacentHTML("beforeend", '<div class="note">Score history starts on the first pipeline run and grows by one point per day.</div>');
  };
  $("#h-go").onclick = draw;
  draw();
}

function cotHeader(title, infoTxt) {
  const last = DATA.cot_list.length ? DATA.cot_list[0].date : null;
  return header(title, { info: infoTxt, right: `<div class="meta-box"><div><b>Last report</b>${esc(fmtDate(last))}</div><div><b>Update interval</b>Weekly, checks 3× daily</div></div>` });
}

function pageCot(el) {
  const L = DATA.cot_list;
  el.innerHTML = cotHeader("COT Net Positioning", "CFTC Commitments of Traders, non-commercial (large speculator) futures positions. Published Fridays with data as of the prior Tuesday.") + `
    <div class="legend"><span><i style="background:${C.blue}"></i>Long</span><span><i style="background:${C.red}"></i>Short</span></div>
    <div class="chart-box" style="height:380px"><canvas id="cot"></canvas></div>
    <p class="source-note">Source: CFTC Commitments of Traders (legacy, futures only)</p>
    <div class="scroll-x mt"><table class="ef" style="width:100%"><thead><tr><th>Symbol</th><th>Long contracts</th><th>Short contracts</th><th>Net position</th><th>Long %</th><th>Weekly change</th><th>Quarterly change</th></tr></thead><tbody>
    ${[...L].reverse().map((c) => `<tr><td>${esc(c.label)}</td><td>${c.long.toLocaleString()}</td><td>${c.short.toLocaleString()}</td><td class="${cellCls(sgn(c.net))}">${c.net.toLocaleString()}</td><td>${c.long_pct.toFixed(2)}%</td><td class="${cellCls(sgn(c.weekly_change))}">${c.weekly_change > 0 ? "+" : ""}${c.weekly_change.toFixed(2)}%</td><td class="${cellCls(sgn(c.quarterly_change))}">${c.quarterly_change == null ? "—" : (c.quarterly_change > 0 ? "+" : "") + c.quarterly_change.toFixed(2) + "%"}</td></tr>`).join("")}
    </tbody></table></div>`;
  chart($("#cot"), {
    type: "bar",
    data: { labels: L.map((c) => c.label), datasets: [
      { label: "Long", data: L.map((c) => c.long_pct), backgroundColor: C.blue, barPercentage: 0.8 },
      { label: "Short", data: L.map((c) => 100 - c.long_pct), backgroundColor: C.red, barPercentage: 0.8 }] },
    options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${x.raw.toFixed(2)}%` } } },
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, max: 100, ticks: { callback: (v) => v + "%" } } } },
  });
}

function pageCotVelocity(el) {
  const L = DATA.cot_list;
  const sets = [["weekly_change", "Weekly change", C.red], ["monthly_change", "Monthly change", C.grey], ["quarterly_change", "Quarterly change", C.blue2]];
  el.innerHTML = cotHeader("COT Velocity", "How fast large speculators are changing their long % over 1, 4 and 13 weeks.") +
    `<div class="three">${sets.map(([k, t, col]) => `<div><div class="legend"><span><i style="background:${col}"></i>${t}</span></div><div class="chart-box" style="height:${Math.max(380, L.length * 22)}px"><canvas id="v-${k}"></canvas></div></div>`).join("")}</div>`;
  for (const [k, t, col] of sets) {
    const rows = L.filter((c) => c[k] != null).sort((a, b) => b[k] - a[k]);
    chart($(`#v-${k}`), { type: "bar", data: { labels: rows.map((c) => c.label), datasets: [{ label: t, data: rows.map((c) => c[k]), backgroundColor: col }] },
      options: { indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { ticks: { callback: (v) => v + "%" } }, y: { grid: { display: false } } } } });
  }
}

function pageRetail(el) {
  const fx = DATA.setups.filter((r) => r.kind === "fx" && r.detail.retail && r.detail.retail.long_pct != null)
    .map((r) => ({ a: r.asset, l: r.detail.retail.long_pct, v: r.columns["Crowd Sentiment"] })).sort((x, y) => y.l - x.l);
  el.innerHTML = header("Retail Sentiment", { info: "Share of retail traders long vs short. 60% or more on one side triggers a contrarian signal: the label turns red when the crowd is heavily long (bearish signal) and blue when heavily short (bullish signal)." }) +
    (fx.length ? `<p class="source-note" style="text-align:left"><u>Contrarian Signal</u></p>${fx.map((x) => `<div class="retail-row">
      <div class="lab ${x.v > 0 ? "bg-bull" : x.v < 0 ? "bg-bear" : "bg-neu"}">${x.a}</div>
      <div class="retail-bar"><div class="l" style="width:${x.l}%">${x.l.toFixed(0)}%</div><div class="s">${(100 - x.l).toFixed(0)}%</div></div></div>`).join("")}
      <p class="source-note">Source: Myfxbook Community Outlook</p>`
      : `<div class="empty">Retail FX positioning comes from the Myfxbook Community Outlook API.<br>Set <code>MYFXBOOK_EMAIL</code> and <code>MYFXBOOK_PASSWORD</code> on the backend (free account) to enable this page.<br><br>Indices, metals and commodities use the <a href="#/pcr">Put-Call Ratio</a> instead.</div>`);
}

function pagePcr(el, asset) {
  asset = asset && ASSET_PCR[asset] ? asset : "SPX500";
  const etf = ASSET_PCR[asset];
  const hist = (DATA.pcr_history || {})[etf] || [];
  const sig = (DATA.pcr || {})[etf] || {};
  el.innerHTML = header("Put-Call Ratio (5 day MA)", {
    info: "Open interest of puts divided by calls on the listed ETF proxy, smoothed with a 5-day moving average. Bands are mean ± 1 standard deviation of the history. Above the high-put line: crowd fearful, contrarian bullish. Below the high-call line: crowd greedy, contrarian bearish.",
    right: `<div style="min-width:260px">${select("p-sym", "Symbol", PCR_ASSETS.map((a) => [a, `${a} (${ASSET_PCR[a]})`]), asset)}</div>`,
  }) + `<div class="chart-box" style="height:520px"><canvas id="pcr"></canvas></div>
  <p class="note">${hist.length} daily reading${hist.length === 1 ? "" : "s"} for ${esc(etf)}. ${sig.high_put == null ? "Threshold bands appear after ~20 readings." : `High put ${sig.high_put} · High call ${sig.high_call} · state: ${esc(sig.state)}`}</p>`;
  $("#p-sym").onchange = (e) => (location.hash = `#/pcr/${e.target.value}`);
  const vals = hist.map((h) => h.ma5);
  const lo = Math.min(...vals, sig.high_call ?? Infinity), hi = Math.max(...vals, sig.high_put ?? -Infinity);
  const pad = Math.max(0.05, (hi - lo) * 0.25);
  chart($("#pcr"), {
    type: "line",
    data: { labels: hist.map((h) => h.date), datasets: [{ label: "PCR 5d MA", data: vals, borderColor: "#fff", borderWidth: 2.5, pointRadius: hist.length < 10 ? 4 : 0, pointBackgroundColor: "#fff" }] },
    options: {
      plugins: { legend: { display: false }, bands: { items: [{ gradient: ["#5e2a2bcc", "#3f4580cc"] }] },
        hlines: { items: [{ y: sig.high_put, color: "#ee5a5b", label: "High Put Volume" }, { y: sig.high_call, color: "#5b8def", label: "High Call Volume" }] } },
      scales: { y: { min: isFinite(lo) ? +(lo - pad).toFixed(2) : undefined, max: isFinite(hi) ? +(hi + pad).toFixed(2) : undefined, position: "left" }, x: { ticks: { maxTicksLimit: 10 } } },
    },
  });
}

function pageAaii(el) {
  const a = DATA.aaii, h = DATA.aaii_history || [];
  if (!a) { el.innerHTML = header("AAII Investor Sentiment") + '<div class="empty">No AAII data yet.</div>'; return; }
  el.innerHTML = header("AAII Investor Sentiment", { info: "Weekly survey of individual investors' six-month stock market outlook. Extreme readings (bull–bear spread beyond ±1.5 standard deviations of the 2-year history) are treated as contrarian signals.", sub: `Survey week ending ${fmtDate(a.date)}` }) + `
  <div class="split">
    <div><div class="legend"><span><i style="background:${C.blue}"></i>Bullish</span><span><i style="background:#9a9aa2"></i>Neutral</span><span><i style="background:${C.red}"></i>Bearish</span></div>
      <div class="chart-box" style="height:380px"><canvas id="aaii"></canvas></div></div>
    <div class="pnl">
      <div class="rows">
        <div class="row" style="grid-template-columns:1fr 110px"><div class="lab">Bullish</div><div class="chip bg-bull">${a.bullish}%</div></div>
        <div class="row" style="grid-template-columns:1fr 110px"><div class="lab">Neutral</div><div class="chip bg-neu">${a.neutral}%</div></div>
        <div class="row" style="grid-template-columns:1fr 110px"><div class="lab">Bearish</div><div class="chip bg-bear">${a.bearish}%</div></div>
        <div class="row" style="grid-template-columns:1fr 110px"><div class="lab">Bull–Bear spread</div><div class="chip ${a.spread > 0 ? "bg-bull" : "bg-bear"}">${a.spread > 0 ? "+" : ""}${a.spread}</div></div>
        <div class="row" style="grid-template-columns:1fr 110px"><div class="lab">Contrarian signal</div><div class="chip ${a.contrarian === "bullish" ? "bg-bull" : a.contrarian === "bearish" ? "bg-bear" : "bg-neu"}">${esc(a.contrarian)}</div></div>
      </div>
      <div class="gauge-wrap">${gauge((a.spread_z + 3) / 6, { size: 200, left: "Fear", right: "Greed", top: "Neutral", value: `z ${a.spread_z}`, leftColor: C.blue, rightColor: C.red })}</div>
    </div>
  </div>
  <p class="source-note">Source: AAII Sentiment Survey</p>`;
  chart($("#aaii"), { type: "line", data: { labels: h.map((x) => x.date), datasets: [
    { label: "Bullish", data: h.map((x) => +(x.bullish * 100).toFixed(1)), borderColor: C.blue2, backgroundColor: C.blue2, pointRadius: 0, borderWidth: 2 },
    { label: "Neutral", data: h.map((x) => +(x.neutral * 100).toFixed(1)), borderColor: "#9a9aa2", pointRadius: 0, borderWidth: 1.5 },
    { label: "Bearish", data: h.map((x) => +(x.bearish * 100).toFixed(1)), borderColor: C.red, pointRadius: 0, borderWidth: 2 }] },
    options: { plugins: { legend: { display: false } }, interaction: { mode: "index", intersect: false }, scales: { y: { ticks: { callback: (v) => v + "%" } }, x: { ticks: { maxTicksLimit: 10 } } } } });
}

function pageHeatmap(el) {
  const us = (DATA.macro || {}).USD || {};
  const order = [["gdp", "GDP Growth QoQ"], ["retail_sales", "Retail Sales MoM"], ["consumer_sent", "Consumer Confidence"], ["cpi_yoy", "CPI YoY"], ["core_cpi_mom", "Core CPI MoM"], ["ppi_mom", "PPI MoM"], ["core_pce_mom", "Core PCE MoM"], ["unemployment", "Unemployment Rate"], ["claims", "US Initial Jobless Claims"], ["jolts", "JOLTS Job Openings"], ["adp", "ADP"], ["nfp", "Non-Farm Payroll"]];
  const group = { gdp: "growth", retail_sales: "growth", consumer_sent: "growth", cpi_yoy: "inflation", core_cpi_mom: "inflation", ppi_mom: "inflation", core_pce_mom: "inflation", unemployment: "labor", claims: "labor", jolts: "labor", adp: "labor", nfp: "labor" };
  let usdPos = 0, stkPos = 0, n = 0;
  const rows = order.filter(([k]) => us[k] && us[k].actual != null).map(([k, label]) => {
    const ind = us[k], s = sgn(ind.surprise) * ind.good_dir;
    const usd = POLARITY.fx[group[k]] * s, stk = POLARITY.index[group[k]] * s;
    n++; if (usd > 0) usdPos++; if (stk > 0) stkPos++;
    const word = (v) => `<td class="imp ${v > 0 ? "bg-bull" : v < 0 ? "bg-bear" : "bg-neu"}">${biasWord(v)}</td>`;
    return `<tr><td>${label}</td><td class="${ind.release && daysAgo(ind.release) <= 7 ? "yellow" : ""}">${esc(fmtPeriod(ind))}</td>
      <td class="imp ${s > 0 ? "bg-bull" : s < 0 ? "bg-bear" : "bg-neu"}">${fmtNum(ind, ind.surprise)}</td>
      <td class="${s > 0 ? "t-bull" : s < 0 ? "t-bear" : ""}">${fmtNum(ind, ind.actual)}</td>
      <td>${ind.forecast != null ? fmtNum(ind, ind.forecast) : '<span class="t-neu" title="No consensus on file">—</span>'}</td>
      <td>${fmtNum(ind, ind.previous)}</td><td style="width:10px;border:0"></td>${word(usd)}${word(stk)}</tr>`;
  }).join("");
  const nonfx = DATA.setups.filter((r) => r.kind !== "fx" && r.detail.macro.USD).sort((a, b) => b.groups.fundamental - a.groups.fundamental);
  const usdPairs = DATA.setups.filter((r) => r.kind === "fx" && /USD/.test(r.asset)).map((r) => ({ a: r.asset, v: r.asset.startsWith("USD") ? r.groups.fundamental : -r.groups.fundamental })).sort((a, b) => b.v - a.v);
  const pu = n ? usdPos / n : 0, ps = n ? stkPos / n : 0;
  el.innerHTML = header("US Economic Heatmap", { info: "Latest US releases: actual vs consensus (or vs the previous print when no consensus is on file). Dates in yellow were released within the last 7 days. Impact columns apply the scoring polarity for the dollar and for stocks." }) + `
  <div class="scroll-x"><table class="heat"><thead><tr><th>US Economic Data</th><th>Date</th><th>Surprise</th><th>Actual</th><th>Forecast</th><th>Previous</th><th style="border:0"></th><th>USD Impact</th><th>Stocks Impact</th></tr></thead><tbody>${rows}</tbody>
  <tfoot><tr><td colspan="7" style="border:0"></td><td class="imp ${pu > 0.5 ? "bg-bull" : pu < 0.5 ? "bg-bear" : "bg-neu"}" style="font-size:22px">${(pu * 100).toFixed(2)}%</td><td class="imp ${ps > 0.5 ? "bg-bull" : ps < 0.5 ? "bg-bear" : "bg-neu"}" style="font-size:22px">${(ps * 100).toFixed(2)}%</td></tr></tfoot></table></div>
  <div class="split mt" style="grid-template-columns:minmax(0,1fr) 460px">
    <div class="two">
      <table class="mini"><thead><tr><th>Asset</th><th>Macro/Eco Score ▾</th></tr></thead><tbody>${nonfx.map((r) => `<tr><td style="background:${rowTint(r.groups.fundamental * 2)}"><a href="#/scorecard/${r.asset}">${r.asset}</a></td><td style="background:${rowTint(r.groups.fundamental * 2)}">${r.groups.fundamental}</td></tr>`).join("")}</tbody></table>
      <table class="mini"><thead><tr><th>Asset</th><th>Eco Score (USD side) ▾</th></tr></thead><tbody>${usdPairs.map((x) => `<tr><td style="background:${rowTint(x.v * 2)}"><a href="#/scorecard/${x.a}">${x.a}</a></td><td style="background:${rowTint(x.v * 2)}">${x.v}</td></tr>`).join("")}</tbody></table>
    </div>
    <div style="display:flex;justify-content:center;gap:12px;flex-wrap:wrap">${gauge(pu, { size: 200, title: "USD", left: "0", right: "1", top: "", value: `${Math.round(pu * 100)}%` })}${gauge(ps, { size: 200, title: "US Stocks", left: "0", right: "1", top: "", value: `${Math.round(ps * 100)}%` })}</div>
  </div>
  <p class="note">Sources: FRED (actuals), ForexFactory weekly calendar (consensus). PMIs and wage growth are not available from free official sources yet.</p>`;
}

function pageGeo(el) {
  const g = DATA.geo_risk;
  if (!g) { el.innerHTML = header("Geopolitical Risk Tracker") + '<div class="empty">No geopolitical reading yet — it is produced by the LLM digest.</div>'; return; }
  const hist = DATA.geo_history || [];
  const events = (g.llm && g.llm.events) || [];
  const cards = events.length ? events.map((e) => ({ t: e.summary, sub: `${e.region} · severity ${e.severity}/5`, tags: e.assets || [] }))
    : (g.headlines || []).slice(0, 6).map((h) => ({ t: h.title, sub: h.source, tags: [] }));
  el.innerHTML = header("Geopolitical Risk Tracker", { info: "0–100 score from the last 24h of news headlines: a keyword scan for terms like war, missile, sanction and nuclear, blended with an open-source LLM's read of severity. Updates about 3 times a day.", sub: `${g.keyword.n_headlines} headlines scanned · keyword score ${g.keyword.score}${g.llm ? ` · LLM score ${g.llm.score}` : ""}` }) + `
  <div class="split">
    <div><div class="legend"><span><i style="background:${C.orange};height:3px;vertical-align:3px"></i>Geo Risk Score</span></div><div class="chart-box" style="height:300px"><canvas id="geo"></canvas></div></div>
    <div style="display:flex;justify-content:center">${gauge(g.score / 100, { size: 240, title: "GeoRisk", left: "Low", right: "High", top: "Medium", value: g.score, leftColor: C.blue, rightColor: "#f33" })}</div>
  </div>
  <div class="card-grid mt">${cards.map((c) => `<article class="ncard"><h3>${esc(c.t)}</h3><div class="date">${esc(fmtDate(g.updated_at || DATA.generated_at))} · ${esc(c.sub)}</div>${c.tags.length ? `<p class="tags" style="padding-top:12px">${c.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</p>` : ""}</article>`).join("")}</div>`;
  chart($("#geo"), { type: "line", data: { labels: hist.map((p) => new Date(p.ts).toLocaleDateString(undefined, { month: "short", day: "numeric" })), datasets: [{ label: "Geo Risk Score", data: hist.map((p) => p.score), borderColor: C.orange, backgroundColor: C.orange, pointRadius: 3 }] },
    options: { plugins: { legend: { display: false }, hlines: { items: [{ y: 70, color: "#ee5a5b", label: "High risk (70 or more)" }, { y: 30, color: "#5b8def", label: "Low risk (30 or less)" }] } }, scales: { y: { min: 0, max: 100 } } } });
}

function pageNews(el) {
  const n = DATA.news || {};
  const items = n.items || [];
  el.innerHTML = header("AI News Feed", { info: "Headlines from the last 24 hours, grouped and summarised by an open-weights LLM. Tags show which markets each story affects." }) +
    (items.length ? `<div class="card-grid">${items.map((i) => `<article class="ncard" style="border-top:4px solid ${i.tone === "bullish" ? C.blue : i.tone === "bearish" ? C.red : "#777"}">
      <h3>${esc(i.title)}</h3><div class="date">${esc(fmtDate(DATA.generated_at))}${i.tone ? " · " + esc(i.tone) : ""}</div><p>${esc(i.summary)}</p>
      <p class="tags">${(i.assets || []).map((a) => `<a class="tag" href="#/scorecard/${esc(a)}">${esc(a)}</a>`).join("")}</p></article>`).join("")}</div>`
      : '<div class="empty">No AI digest yet. It appears once the backend has an LLM key configured.</div>') +
    ((n.headlines || []).length ? `<h2 style="font-size:15px;color:var(--muted);margin:26px 0 10px;font-weight:500">SOURCE HEADLINES</h2><ul style="margin:0;padding-left:18px;line-height:1.7">${n.headlines.slice(0, 25).map((h) => `<li><a href="${esc(h.link)}" target="_blank" rel="noopener noreferrer">${esc(h.title)}</a> <span class="note">${esc(h.source)}</span></li>`).join("")}</ul>` : "");
}

/* ---------------- router ---------------- */
const ROUTES = { "top-setups": pageTopSetups, scorecard: pageScorecard, history: pageHistory, cot: pageCot, "cot-velocity": pageCotVelocity,
  retail: pageRetail, pcr: pagePcr, aaii: pageAaii, heatmap: pageHeatmap, geo: pageGeo, news: pageNews };

function renderNav(active) {
  $("#navlinks").innerHTML = PAGES.map(([sec, items]) => `<div class="sec">${sec}</div>${items.map(([id, t]) => `<a href="#/${id}" class="${id === active ? "on" : ""}">${t}</a>`).join("")}`).join("");
  if (DATA) {
    const src = Object.entries(DATA.sources);
    $("#navfoot").innerHTML = `Data last updated<br><b style="color:#ddd">${esc(new Date(DATA.generated_at).toLocaleString())}</b>
      <div class="dots">${src.map(([k, v]) => `<span class="dot ${v.ok ? "" : "bad"}" title="${esc(k)}: ${v.ok ? "ok" : esc(v.error || "unavailable")}"></span>`).join("")}</div>`;
  }
}

function render() {
  const [, route = "top-setups", arg] = (location.hash || "#/top-setups").split("/");
  const page = ROUTES[route] ? route : "top-setups";
  renderNav(page);
  $("#nav").classList.remove("open");
  charts.forEach((c) => c.destroy()); charts = [];
  window.scrollTo(0, 0);
  const el = $("#page");
  if (!DATA) return;
  const title = PAGES.flatMap(([, i]) => i).find(([id]) => id === page)?.[1] || "";
  $("#topbar-title").textContent = title;
  document.title = `${title} · EdgeFinder Open`;
  ROUTES[page](el, arg && decodeURIComponent(arg).toUpperCase());
}

async function load() {
  try {
    const r = await fetch(`${API}/dashboard`, { cache: "no-store" });
    if (r.status === 503) { $("#page").innerHTML = '<div class="empty">The first data run is in progress — refresh in a few minutes.</div>'; return; }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const fresh = await r.json();
    const changed = !DATA || fresh.generated_at !== DATA.generated_at;
    DATA = fresh;
    if (changed) render();
  } catch (e) {
    if (!DATA) $("#page").innerHTML = `<div class="empty">Could not load data (${esc(e.message)}).</div>`;
  }
}

window.addEventListener("hashchange", render);
$("#menu").onclick = () => $("#nav").classList.toggle("open");
renderNav("top-setups");
load();
setInterval(load, 10 * 60 * 1000);
