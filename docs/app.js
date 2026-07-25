/* RRG Monitor — Phase 3 animated coordinated dashboard.
 *
 * One time index drives every view:
 *   - RRG scatter: dots at week `idx` with fading comet-tail trails
 *   - SPY (benchmark) price strip with regime shading + a moving playhead
 *   - Rotation heatmap: each security's quadrant, week by week
 *   - Standings + context: recomputed for `idx`
 * Play/pause animates the index; the slider and either strip scrub it.
 * Vanilla JS + SVG only — no external libraries.
 */
(() => {
  "use strict";

  const UNIVERSE = "sectors"; // Phase 4 makes this selectable
  const SVGNS = "http://www.w3.org/2000/svg";
  const TRAIL_WEEKS = 10;
  const STEP_MS = 500;

  const QUAD_COLORS = {
    Leading: "#3fb950", Improving: "#58a6ff",
    Weakening: "#d29922", Lagging: "#f85149", unknown: "#8b949e",
  };

  // RRG viewBox geometry
  const VB = 560, PAD_L = 60, PAD_R = 26, PAD_T = 22, PAD_B = 50;
  const PLOT_W = VB - PAD_L - PAD_R, PLOT_H = VB - PAD_T - PAD_B;
  // Strip geometry (shared x-axis between SPY strip and heatmap)
  const STRIP_W = 920, S_L = 48, S_R = 16, STRIP_PLOT = STRIP_W - S_L - S_R;

  const el = (tag, attrs = {}, parent = null) => {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  };
  const fmt = (v) => (v == null || Number.isNaN(v) ? "—" : v.toFixed(1));
  const color = (q) => QUAD_COLORS[q] || QUAD_COLORS.unknown;

  // ── module state ────────────────────────────────────────────────────────
  let DATA, T, SECS, DATES, sx, sy;
  let idx = 0, playing = false, timer = null;
  let cellW, xAt, yPrice;
  const heads = new Map(); // ticker -> {dot, label}
  let gTrails, spyPlayhead, spyMarker, heatPlayhead;
  let rrgSvg;

  const cur = (s) => ({
    ticker: s.ticker, name: s.name,
    rsRatio: s.r[idx], rsMom: s.m[idx], quad: s.q[idx] || "unknown",
  });

  async function main() {
    const status = document.getElementById("status");
    try {
      const res = await fetch(`data/${UNIVERSE}.json`, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      DATA = await res.json();
    } catch (err) {
      status.textContent = `Could not load rotation data (${err.message}).`;
      status.classList.add("error");
      return;
    }

    DATES = DATA.dates;
    T = DATES.length - 1;
    SECS = DATA.securities.map((s) => ({
      ticker: s.ticker, name: s.name || s.ticker,
      r: s.rs_ratio, m: s.rs_momentum, q: s.quadrant,
    }));

    makeScales();
    buildChart();
    buildSpy();
    buildHeat();
    buildTransport();

    idx = T;
    setIndex(T);

    status.hidden = true;
    document.getElementById("layout").hidden = false;
    document.getElementById("timeline").hidden = false;
    document.getElementById("legend").hidden = false;
  }

  // ── scales (fixed domain over the whole visible history) ──────────────────
  function makeScales() {
    let dev = 2.5;
    for (const s of SECS) {
      for (let t = 0; t <= T; t++) {
        if (s.r[t] != null) dev = Math.max(dev, Math.abs(s.r[t] - 100));
        if (s.m[t] != null) dev = Math.max(dev, Math.abs(s.m[t] - 100));
      }
    }
    dev *= 1.12;
    const lo = 100 - dev, hi = 100 + dev;
    sx = (v) => PAD_L + ((v - lo) / (hi - lo)) * PLOT_W;
    sy = (v) => PAD_T + ((hi - v) / (hi - lo)) * PLOT_H;
  }

  // ── RRG chrome + persistent head dots ─────────────────────────────────────
  function buildChart() {
    const svg = (rrgSvg = document.getElementById("rrg"));
    const cx = sx(100), cy = sy(100);
    const L = PAD_L, R = PAD_L + PLOT_W, Tp = PAD_T, B = PAD_T + PLOT_H;

    const quad = (x, y, w, h, c) =>
      el("rect", { x, y, width: w, height: h, fill: c, "fill-opacity": 0.08 }, svg);
    quad(cx, Tp, R - cx, cy - Tp, QUAD_COLORS.Leading);
    quad(cx, cy, R - cx, B - cy, QUAD_COLORS.Weakening);
    quad(L, cy, cx - L, B - cy, QUAD_COLORS.Lagging);
    quad(L, Tp, cx - L, cy - Tp, QUAD_COLORS.Improving);

    for (let i = 1; i < 4; i++) {
      const gx = L + (PLOT_W * i) / 4, gy = Tp + (PLOT_H * i) / 4;
      el("line", { x1: gx, y1: Tp, x2: gx, y2: B, class: "grid-line" }, svg);
      el("line", { x1: L, y1: gy, x2: R, y2: gy, class: "grid-line" }, svg);
    }
    el("rect", { x: L, y: Tp, width: PLOT_W, height: PLOT_H, class: "frame" }, svg);
    el("line", { x1: cx, y1: Tp, x2: cx, y2: B, class: "center-line" }, svg);
    el("line", { x1: L, y1: cy, x2: R, y2: cy, class: "center-line" }, svg);

    const corner = (text, x, y, anchor, c) => {
      const t = el("text", { x, y, "text-anchor": anchor, class: "quad-label", fill: c, opacity: 0.8 }, svg);
      t.textContent = text;
    };
    corner("LEADING", R - 8, Tp + 15, "end", QUAD_COLORS.Leading);
    corner("IMPROVING", L + 8, Tp + 15, "start", QUAD_COLORS.Improving);
    corner("WEAKENING", R - 8, B - 8, "end", QUAD_COLORS.Weakening);
    corner("LAGGING", L + 8, B - 8, "start", QUAD_COLORS.Lagging);

    const ax = el("text", { x: L + PLOT_W / 2, y: B + 34, "text-anchor": "middle", class: "axis-title" }, svg);
    ax.textContent = "JdK RS-Ratio  →  relative strength";
    const ay = el("text", { x: 16, y: Tp + PLOT_H / 2, "text-anchor": "middle", class: "axis-title", transform: `rotate(-90 16 ${Tp + PLOT_H / 2})` }, svg);
    ay.textContent = "JdK RS-Momentum  →";

    el("circle", { cx, cy, r: 3, fill: "#8b949e" }, svg);

    gTrails = el("g", { id: "trails" }, svg); // trails under the head dots

    // Persistent head dots + labels (updated per frame; CSS transitions glide them)
    for (const s of SECS) {
      const dot = el("circle", {
        r: 6, fill: color(s.q[T]), stroke: "#0d1117", "stroke-width": 1.5,
        class: "rrg-dot", tabindex: 0, "data-ticker": s.ticker,
      }, svg);
      const label = el("text", { class: "rrg-label" }, svg);
      label.textContent = s.ticker;
      heads.set(s.ticker, { dot, label });

      const enter = (ev) => showTooltip(ev, s);
      dot.addEventListener("mouseenter", enter);
      dot.addEventListener("mousemove", enter);
      dot.addEventListener("mouseleave", hideTooltip);
      dot.addEventListener("focus", (ev) => showTooltip(ev, s, true));
      dot.addEventListener("blur", hideTooltip);
    }
  }

  function drawTrails(c) {
    while (gTrails.firstChild) gTrails.removeChild(gTrails.firstChild);
    const start = Math.max(0, c - TRAIL_WEEKS + 1);
    for (const s of SECS) {
      const pts = [];
      for (let k = start; k <= c; k++) {
        if (s.r[k] != null && s.m[k] != null)
          pts.push({ x: sx(s.r[k]), y: sy(s.m[k]), q: s.q[k] });
      }
      if (pts.length < 2) continue;
      const d = pts.map((p, i) => (i ? "L" : "M") + p.x.toFixed(1) + " " + p.y.toFixed(1)).join(" ");
      el("path", { d, fill: "none", stroke: color(s.q[c]), "stroke-width": 1.4, "stroke-opacity": 0.3, "stroke-linecap": "round", "stroke-linejoin": "round" }, gTrails);
      for (let i = 0; i < pts.length - 1; i++) {
        const f = i / (pts.length - 1);
        el("circle", { cx: pts[i].x, cy: pts[i].y, r: 1.5 + f * 2.2, fill: color(pts[i].q), "fill-opacity": 0.25 + 0.5 * f }, gTrails);
      }
    }
  }

  // ── SPY price strip ───────────────────────────────────────────────────────
  function buildSpy() {
    const svg = document.getElementById("spy");
    const S_T = 14, S_B = 22, H = 120;
    const closes = DATA.benchmark_series.close, reg = DATA.benchmark_series.regime;
    cellW = STRIP_PLOT / (T + 1);
    xAt = (t) => S_L + (t + 0.5) * cellW;

    const valid = closes.filter((v) => v != null);
    const pmin = Math.min(...valid), pmax = Math.max(...valid);
    yPrice = (v) => S_T + ((pmax - v) / (pmax - pmin || 1)) * (H - S_T - S_B);

    // Regime bands (contiguous runs)
    const REG_FILL = { bull: [QUAD_COLORS.Leading, 0.06], correction: [QUAD_COLORS.Weakening, 0.09], bear: [QUAD_COLORS.Lagging, 0.11] };
    let runStart = 0;
    for (let t = 1; t <= T + 1; t++) {
      if (t > T || reg[t] !== reg[runStart]) {
        const rname = reg[runStart];
        const style = REG_FILL[rname];
        if (style) {
          const x0 = S_L + runStart * cellW, x1 = S_L + Math.min(t, T + 1) * cellW;
          el("rect", { x: x0, y: S_T, width: x1 - x0, height: H - S_T - S_B, fill: style[0], "fill-opacity": style[1] }, svg);
        }
        runStart = t;
      }
    }

    // Price line
    let d = "";
    for (let t = 0; t <= T; t++) {
      if (closes[t] == null) continue;
      d += (d ? "L" : "M") + xAt(t).toFixed(1) + " " + yPrice(closes[t]).toFixed(1) + " ";
    }
    el("path", { d: d.trim(), class: "spy-line" }, svg);

    // Playhead + marker (updated in setIndex)
    spyPlayhead = el("line", { y1: S_T - 3, y2: H - S_B, class: "playhead" }, svg);
    spyMarker = el("circle", { r: 4, class: "spy-marker" }, svg);

    enableScrub(svg);
  }

  // ── Rotation heatmap ──────────────────────────────────────────────────────
  function buildHeat() {
    const svg = document.getElementById("heat");
    const H = 250, H_T = 8, H_B = 24;
    const rows = [...SECS].sort((a, b) => (b.r[T] ?? -1e9) - (a.r[T] ?? -1e9));
    const rowH = (H - H_T - H_B) / rows.length;

    rows.forEach((s, i) => {
      const y = H_T + i * rowH;
      const lab = el("text", { x: S_L - 6, y: y + rowH / 2 + 3, "text-anchor": "end", class: "hm-row-label" }, svg);
      lab.textContent = s.ticker;
      for (let t = 0; t <= T; t++) {
        el("rect", {
          x: (S_L + t * cellW).toFixed(2), y: y + 1, width: Math.max(cellW - 0.6, 0.6).toFixed(2), height: rowH - 3,
          rx: 1.5, fill: color(s.q[t]), "fill-opacity": 0.82,
        }, svg);
      }
    });

    // Date ticks (shared x-axis label for the whole stack)
    const nTicks = 6;
    for (let i = 0; i < nTicks; i++) {
      const t = Math.round((i / (nTicks - 1)) * T);
      const tx = el("text", { x: xAt(t), y: H - 8, "text-anchor": "middle", class: "strip-tick" }, svg);
      tx.textContent = DATES[t].slice(2); // YY-MM-DD -> MM-DD-ish
    }

    heatPlayhead = el("line", { y1: H_T - 2, y2: H_T + rows.length * rowH, class: "playhead" }, svg);
    enableScrub(svg);
  }

  // ── the one function that moves everything ────────────────────────────────
  function setIndex(c) {
    idx = Math.max(0, Math.min(T, c));

    drawTrails(idx);

    for (const s of SECS) {
      const { dot, label } = heads.get(s.ticker);
      const r = s.r[idx], m = s.m[idx];
      if (r == null || m == null) { dot.setAttribute("visibility", "hidden"); label.setAttribute("visibility", "hidden"); continue; }
      dot.removeAttribute("visibility"); label.removeAttribute("visibility");
      const x = sx(r), y = sy(m);
      dot.setAttribute("cx", x); dot.setAttribute("cy", y);
      dot.setAttribute("fill", color(s.q[idx]));
      dot.setAttribute("aria-label", `${s.ticker} ${s.name}: RS-Ratio ${fmt(r)}, RS-Momentum ${fmt(m)}, ${s.q[idx]}`);
      const flip = x > PAD_L + PLOT_W - 42;
      label.setAttribute("x", flip ? x - 9 : x + 9);
      label.setAttribute("y", y + 4);
      label.setAttribute("text-anchor", flip ? "end" : "start");
    }

    // playheads
    const px = xAt(idx);
    spyPlayhead.setAttribute("x1", px); spyPlayhead.setAttribute("x2", px);
    const close = DATA.benchmark_series.close[idx];
    if (close != null) { spyMarker.removeAttribute("visibility"); spyMarker.setAttribute("cx", px); spyMarker.setAttribute("cy", yPrice(close)); }
    else spyMarker.setAttribute("visibility", "hidden");
    heatPlayhead.setAttribute("x1", px); heatPlayhead.setAttribute("x2", px);

    renderStandings();
    renderMeta();

    const slider = document.getElementById("slider");
    if (+slider.value !== idx) slider.value = idx;
    const wl = document.getElementById("week-label");
    wl.innerHTML = `week of <strong>${DATES[idx]}</strong>`;
  }

  function renderMeta() {
    const regime = DATA.benchmark_series.regime[idx] || "unknown";
    const cap = regime.charAt(0).toUpperCase() + regime.slice(1);
    document.getElementById("meta").innerHTML =
      `<span class="chip"><strong>${DATA.universe.label}</strong></span>` +
      `<span class="chip">vs <strong>${DATA.universe.benchmark}</strong></span>` +
      `<span class="chip regime-${regime}"><span class="swatch"></span>${cap}</span>` +
      `<span class="chip">as of <strong>${DATES[idx]}</strong></span>`;
    document.getElementById("chart-note").textContent = `${DATA.universe.benchmark} at center (100, 100)`;
  }

  function renderStandings() {
    const body = document.getElementById("standings-body");
    const rows = SECS.map(cur).filter((p) => p.rsRatio != null).sort((a, b) => b.rsRatio - a.rsRatio);
    body.innerHTML = "";
    for (const p of rows) {
      const c = color(p.quad);
      const tr = document.createElement("tr");
      tr.setAttribute("data-ticker", p.ticker);
      tr.innerHTML =
        `<td class="sym"><span class="qd" style="background:${c}"></span>${p.ticker}<span class="name">${p.name}</span></td>` +
        `<td class="num">${fmt(p.rsRatio)}</td><td class="num">${fmt(p.rsMom)}</td>`;
      tr.addEventListener("mouseenter", () => highlight(p.ticker, true));
      tr.addEventListener("mouseleave", () => highlight(null, false));
      body.appendChild(tr);
    }
  }

  // ── tooltip + linked highlight ────────────────────────────────────────────
  const tip = () => document.getElementById("tooltip");

  function showTooltip(ev, s, atElement = false) {
    const p = cur(s);
    if (p.rsRatio == null) return;
    const c = color(p.quad), t = tip();
    t.innerHTML =
      `<div class="tt-head"><span class="swatch" style="background:${c}"></span>${p.ticker} · ${p.name}</div>` +
      `<div class="tt-row"><span>RS-Ratio</span><span>${fmt(p.rsRatio)}</span></div>` +
      `<div class="tt-row"><span>RS-Momentum</span><span>${fmt(p.rsMom)}</span></div>` +
      `<div class="tt-row"><span>Quadrant</span><span style="color:${c}">${p.quad}</span></div>`;
    t.hidden = false;
    let px, py;
    if (atElement) { const r = ev.target.getBoundingClientRect(); px = r.right + 8; py = r.top; }
    else { px = ev.clientX + 14; py = ev.clientY + 14; }
    const w = t.offsetWidth, h = t.offsetHeight;
    if (px + w > window.innerWidth - 8) px = window.innerWidth - w - 8;
    if (py + h > window.innerHeight - 8) py = window.innerHeight - h - 8;
    t.style.left = px + "px"; t.style.top = py + "px";
    highlight(p.ticker, true);
  }
  function hideTooltip() { tip().hidden = true; highlight(null, false); }

  function highlight(ticker, on) {
    heads.forEach((h, tk) => h.dot.setAttribute("r", on && tk === ticker ? "8.5" : "6"));
    document.querySelectorAll(".standings tr[data-ticker]").forEach((row) =>
      row.classList.toggle("hl", on && row.getAttribute("data-ticker") === ticker));
  }

  // ── transport (play / slider / scrub) ─────────────────────────────────────
  function buildTransport() {
    const slider = document.getElementById("slider");
    slider.max = T; slider.value = T;
    slider.addEventListener("input", () => { pause(); rrgSvg.classList.add("no-anim"); setIndex(+slider.value); });
    slider.addEventListener("change", () => rrgSvg.classList.remove("no-anim"));
    document.getElementById("play").addEventListener("click", () => (playing ? pause() : play()));
  }

  function play() {
    if (idx >= T) idx = 0;
    playing = true;
    rrgSvg.classList.remove("no-anim");
    document.getElementById("play").textContent = "❚❚";
    document.getElementById("play").title = "Pause";
    step();
  }
  function step() {
    if (!playing) return;
    setIndex(idx);
    if (idx >= T) { pause(); return; }
    idx++;
    timer = setTimeout(step, STEP_MS);
  }
  function pause() {
    playing = false;
    clearTimeout(timer);
    const b = document.getElementById("play");
    b.textContent = "▶"; b.title = "Play";
  }

  function enableScrub(svg) {
    let dragging = false;
    const toIndex = (clientX) => {
      const rect = svg.getBoundingClientRect();
      const vbX = ((clientX - rect.left) / rect.width) * STRIP_W;
      return Math.round((vbX - S_L) / cellW - 0.5);
    };
    const go = (clientX) => { pause(); rrgSvg.classList.add("no-anim"); setIndex(toIndex(clientX)); };
    svg.addEventListener("pointerdown", (e) => { dragging = true; svg.setPointerCapture(e.pointerId); go(e.clientX); });
    svg.addEventListener("pointermove", (e) => { if (dragging) go(e.clientX); });
    const end = () => { dragging = false; rrgSvg.classList.remove("no-anim"); };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
  }

  main();
})();
