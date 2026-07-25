/* RRG Monitor — Phase 2 static snapshot renderer.
 *
 * Reads docs/data/<universe>.json and draws the latest week's Relative
 * Rotation Graph: quadrant background, dots colored by quadrant with labels,
 * hover tooltips, and a linked standings table. Vanilla JS + SVG (self-
 * contained, no external libraries). The Canvas trail/animation layer arrives
 * in Phase 3 and sits beneath this SVG layer.
 */
(() => {
  "use strict";

  const UNIVERSE = "sectors"; // Phase 4 makes this selectable
  const SVGNS = "http://www.w3.org/2000/svg";

  const QUAD_COLORS = {
    Leading: "#3fb950",
    Improving: "#58a6ff",
    Weakening: "#d29922",
    Lagging: "#f85149",
    unknown: "#8b949e",
  };

  // SVG viewBox geometry
  const VB = 560, PAD_L = 60, PAD_R = 26, PAD_T = 22, PAD_B = 50;
  const PLOT_W = VB - PAD_L - PAD_R;
  const PLOT_H = VB - PAD_T - PAD_B;

  const el = (tag, attrs = {}, parent = null) => {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  };
  const fmt = (v) => (v == null || Number.isNaN(v) ? "—" : v.toFixed(1));

  async function main() {
    const status = document.getElementById("status");
    let data;
    try {
      const res = await fetch(`data/${UNIVERSE}.json`, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch (err) {
      status.textContent = `Could not load rotation data (${err.message}).`;
      status.classList.add("error");
      return;
    }

    const T = data.dates.length - 1; // latest index
    const asOf = data.dates[T];
    const regime = data.benchmark_series.regime[T] || "unknown";

    // Latest snapshot per security (drop any without a current point).
    const points = data.securities
      .map((s) => ({
        ticker: s.ticker,
        name: s.name || s.ticker,
        rsRatio: s.rs_ratio[T],
        rsMom: s.rs_momentum[T],
        quad: s.quadrant[T] || "unknown",
      }))
      .filter((p) => p.rsRatio != null && p.rsMom != null);

    renderMeta(data, asOf, regime);
    renderChart(points);
    renderStandings(points);
    renderChartSummary(points, data, asOf);

    status.hidden = true;
    document.getElementById("layout").hidden = false;
    document.getElementById("legend").hidden = false;
  }

  function renderMeta(data, asOf, regime) {
    const meta = document.getElementById("meta");
    const cap = regime.charAt(0).toUpperCase() + regime.slice(1);
    meta.innerHTML =
      `<span class="chip"><strong>${data.universe.label}</strong></span>` +
      `<span class="chip">vs <strong>${data.universe.benchmark}</strong></span>` +
      `<span class="chip regime-${regime}"><span class="swatch"></span>${cap}</span>` +
      `<span class="chip">as of <strong>${asOf}</strong></span>`;
    document.getElementById("chart-note").textContent =
      `${data.universe.benchmark} at center (100, 100)`;
  }

  // ── scales ────────────────────────────────────────────────────────────────
  function makeScales(points) {
    let dev = 2.5;
    for (const p of points) {
      dev = Math.max(dev, Math.abs(p.rsRatio - 100), Math.abs(p.rsMom - 100));
    }
    dev *= 1.15; // padding so dots aren't on the frame
    const lo = 100 - dev, hi = 100 + dev;
    const sx = (v) => PAD_L + ((v - lo) / (hi - lo)) * PLOT_W;
    const sy = (v) => PAD_T + ((hi - v) / (hi - lo)) * PLOT_H; // invert Y
    return { sx, sy, lo, hi };
  }

  function renderChart(points) {
    const svg = document.getElementById("rrg");
    const { sx, sy, lo, hi } = makeScales(points);
    const cx = sx(100), cy = sy(100);
    const L = PAD_L, R = PAD_L + PLOT_W, Tp = PAD_T, B = PAD_T + PLOT_H;

    // Quadrant fills (very low alpha)
    const quad = (x, y, w, h, color) =>
      el("rect", { x, y, width: w, height: h, fill: color, "fill-opacity": 0.08 }, svg);
    quad(cx, Tp, R - cx, cy - Tp, QUAD_COLORS.Leading);
    quad(cx, cy, R - cx, B - cy, QUAD_COLORS.Weakening);
    quad(L, cy, cx - L, B - cy, QUAD_COLORS.Lagging);
    quad(L, Tp, cx - L, cy - Tp, QUAD_COLORS.Improving);

    // Soft gridlines at quartiles
    for (let i = 1; i < 4; i++) {
      const gx = L + (PLOT_W * i) / 4, gy = Tp + (PLOT_H * i) / 4;
      el("line", { x1: gx, y1: Tp, x2: gx, y2: B, class: "grid-line" }, svg);
      el("line", { x1: L, y1: gy, x2: R, y2: gy, class: "grid-line" }, svg);
    }

    // Frame + center cross
    el("rect", { x: L, y: Tp, width: PLOT_W, height: PLOT_H, class: "frame" }, svg);
    el("line", { x1: cx, y1: Tp, x2: cx, y2: B, class: "center-line" }, svg);
    el("line", { x1: L, y1: cy, x2: R, y2: cy, class: "center-line" }, svg);

    // Corner labels
    const corner = (text, x, y, anchor, color) => {
      const t = el("text", { x, y, "text-anchor": anchor, class: "quad-label", fill: color, opacity: 0.8 }, svg);
      t.textContent = text;
    };
    corner("LEADING", R - 8, Tp + 15, "end", QUAD_COLORS.Leading);
    corner("IMPROVING", L + 8, Tp + 15, "start", QUAD_COLORS.Improving);
    corner("WEAKENING", R - 8, B - 8, "end", QUAD_COLORS.Weakening);
    corner("LAGGING", L + 8, B - 8, "start", QUAD_COLORS.Lagging);

    // Axis titles
    const ax = el("text", { x: L + PLOT_W / 2, y: B + 34, "text-anchor": "middle", class: "axis-title" }, svg);
    ax.textContent = "JdK RS-Ratio  →  relative strength";
    const ay = el("text", { x: 16, y: Tp + PLOT_H / 2, "text-anchor": "middle", class: "axis-title", transform: `rotate(-90 16 ${Tp + PLOT_H / 2})` }, svg);
    ay.textContent = "JdK RS-Momentum  →";

    // Benchmark marker at center
    el("circle", { cx, cy, r: 3, fill: "#8b949e" }, svg);

    // Dots + labels
    for (const p of points) {
      const x = sx(p.rsRatio), y = sy(p.rsMom), color = QUAD_COLORS[p.quad] || QUAD_COLORS.unknown;
      const dot = el("circle", {
        cx: x, cy: y, r: 6, fill: color, stroke: "#0d1117", "stroke-width": 1.5,
        class: "rrg-dot", tabindex: 0, "data-ticker": p.ticker,
        "aria-label": `${p.ticker} ${p.name}: RS-Ratio ${fmt(p.rsRatio)}, RS-Momentum ${fmt(p.rsMom)}, ${p.quad}`,
      }, svg);
      // label; flip to the left if close to the right frame
      const flip = x > R - 42;
      const lab = el("text", {
        x: flip ? x - 9 : x + 9, y: y + 4, "text-anchor": flip ? "end" : "start", class: "rrg-label",
      }, svg);
      lab.textContent = p.ticker;

      const enter = (ev) => showTooltip(ev, p), leave = () => hideTooltip();
      dot.addEventListener("mouseenter", enter);
      dot.addEventListener("mousemove", enter);
      dot.addEventListener("mouseleave", leave);
      dot.addEventListener("focus", (ev) => showTooltip(ev, p, true));
      dot.addEventListener("blur", leave);
    }
  }

  // ── tooltip + linked highlight ────────────────────────────────────────────
  const tip = () => document.getElementById("tooltip");

  function showTooltip(ev, p, atElement = false) {
    const t = tip();
    const color = QUAD_COLORS[p.quad] || QUAD_COLORS.unknown;
    t.innerHTML =
      `<div class="tt-head"><span class="swatch" style="background:${color}"></span>${p.ticker} · ${p.name}</div>` +
      `<div class="tt-row"><span>RS-Ratio</span><span>${fmt(p.rsRatio)}</span></div>` +
      `<div class="tt-row"><span>RS-Momentum</span><span>${fmt(p.rsMom)}</span></div>` +
      `<div class="tt-row"><span>Quadrant</span><span style="color:${color}">${p.quad}</span></div>`;
    t.hidden = false;
    let px, py;
    if (atElement) {
      const r = ev.target.getBoundingClientRect();
      px = r.right + 8; py = r.top;
    } else {
      px = ev.clientX + 14; py = ev.clientY + 14;
    }
    // keep on screen
    const w = t.offsetWidth, h = t.offsetHeight;
    if (px + w > window.innerWidth - 8) px = window.innerWidth - w - 8;
    if (py + h > window.innerHeight - 8) py = window.innerHeight - h - 8;
    t.style.left = px + "px";
    t.style.top = py + "px";
    highlight(p.ticker, true);
  }

  function hideTooltip() {
    tip().hidden = true;
    highlight(null, false);
  }

  function highlight(ticker, on) {
    document.querySelectorAll(".rrg-dot").forEach((d) => {
      const match = d.getAttribute("data-ticker") === ticker;
      d.setAttribute("r", on && match ? "8.5" : "6");
    });
    document.querySelectorAll(".standings tr[data-ticker]").forEach((row) => {
      row.classList.toggle("hl", on && row.getAttribute("data-ticker") === ticker);
    });
  }

  // ── standings ─────────────────────────────────────────────────────────────
  function renderStandings(points) {
    const body = document.getElementById("standings-body");
    const rows = [...points].sort((a, b) => b.rsRatio - a.rsRatio);
    body.innerHTML = "";
    for (const p of rows) {
      const color = QUAD_COLORS[p.quad] || QUAD_COLORS.unknown;
      const tr = document.createElement("tr");
      tr.setAttribute("data-ticker", p.ticker);
      tr.innerHTML =
        `<td class="sym"><span class="qd" style="background:${color}"></span>${p.ticker}<span class="name">${p.name}</span></td>` +
        `<td class="num">${fmt(p.rsRatio)}</td>` +
        `<td class="num">${fmt(p.rsMom)}</td>`;
      tr.addEventListener("mouseenter", () => highlight(p.ticker, true));
      tr.addEventListener("mouseleave", () => highlight(null, false));
      body.appendChild(tr);
    }
  }

  function renderChartSummary(points, data, asOf) {
    const tally = {};
    for (const p of points) tally[p.quad] = (tally[p.quad] || 0) + 1;
    const parts = ["Leading", "Improving", "Weakening", "Lagging"]
      .filter((q) => tally[q])
      .map((q) => `${tally[q]} ${q}`);
    document.getElementById("chart-sr").textContent =
      `Relative Rotation Graph of ${points.length} ${data.universe.label} vs ${data.universe.benchmark} as of ${asOf}: ${parts.join(", ")}.`;
  }

  main();
})();
