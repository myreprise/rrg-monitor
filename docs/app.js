/* RRG Monitor — Phase 4 (multi-universe, themed, decluttered).
 *
 * Phase 3's animated coordinated dashboard, now with:
 *   - a universe selector (sectors / mag7 / global) that reloads + rebuilds
 *   - light / dark theme toggle (persisted)
 *   - radial label placement so the central cluster fans out, + text halo
 *   - keyboard scrubbing (← → step, space play/pause)
 * Vanilla JS + SVG only — no external libraries.
 */
(() => {
  "use strict";

  const SVGNS = "http://www.w3.org/2000/svg";
  const TRAIL_WEEKS = 10;
  const STEP_MS = 500;

  const QUAD_COLORS = {
    Leading: "#3fb950", Improving: "#58a6ff",
    Weakening: "#d29922", Lagging: "#f85149", unknown: "#8b949e",
  };

  const VB = 560, PAD_L = 60, PAD_R = 26, PAD_T = 22, PAD_B = 50;
  const PLOT_W = VB - PAD_L - PAD_R, PLOT_H = VB - PAD_T - PAD_B;
  const STRIP_W = 920, S_L = 48, S_R = 16, STRIP_PLOT = STRIP_W - S_L - S_R;
  // RRG is drawn as a true square (equal scale on both axes) centered on 100.
  const cxp = PAD_L + PLOT_W / 2, cyp = PAD_T + PLOT_H / 2, RPIX = Math.min(PLOT_W, PLOT_H) / 2;
  const MIN_DEV = 5, DEV_PAD = 0.12; // floor so a tight cluster can't over-zoom; padding margin

  const el = (tag, attrs = {}, parent = null) => {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  };
  const fmt = (v) => (v == null || Number.isNaN(v) ? "—" : v.toFixed(1));
  const color = (q) => QUAD_COLORS[q] || QUAD_COLORS.unknown;
  const byId = (id) => document.getElementById(id);

  // ── module state ────────────────────────────────────────────────────────
  const cache = {};
  let DATA, T, SECS, DATES;
  // Square domain half-extent (RS units), refit each frame to the visible spread.
  let curDev = 10;
  const sx = (v) => cxp + ((v - 100) / curDev) * RPIX;
  const sy = (v) => cyp - ((v - 100) / curDev) * RPIX;
  let idx = 0, playing = false, timer = null;
  let cellW, xAt, yPrice;
  const heads = new Map();
  let gTrails, spyPlayhead, spyMarker, heatPlayhead, rrgSvg;

  const cur = (s) => ({ ticker: s.ticker, name: s.name, rsRatio: s.r[idx], rsMom: s.m[idx], quad: s.q[idx] || "unknown" });

  // ── boot ──────────────────────────────────────────────────────────────────
  function main() {
    wireControlsOnce();
    initTheme();
    loadUniverse(byId("universe").value);
  }

  async function loadUniverse(id) {
    const app = document.querySelector(".app");
    const first = !DATA;
    if (!first) app.classList.add("switching");
    let d;
    try {
      if (cache[id]) d = cache[id];
      else {
        const res = await fetch(`data/${id}.json`, { cache: "no-cache" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        d = await res.json();
        cache[id] = d;
      }
    } catch (err) {
      if (first) { const s = byId("status"); s.textContent = `Could not load rotation data (${err.message}).`; s.classList.add("error"); }
      app.classList.remove("switching");
      return;
    }

    pause();
    DATA = d; DATES = d.dates; T = DATES.length - 1;
    SECS = d.securities.map((s) => ({ ticker: s.ticker, name: s.name || s.ticker, r: s.rs_ratio, m: s.rs_momentum, q: s.quadrant }));

    teardown();
    buildChart();
    buildSpy();
    buildHeat();
    byId("slider").max = T;

    idx = T;
    setIndex(T);

    if (first) {
      byId("status").hidden = true;
      byId("layout").hidden = false;
      byId("timeline").hidden = false;
      byId("legend").hidden = false;
    }
    app.classList.remove("switching");
  }

  function teardown() {
    pause();
    ["rrg", "spy", "heat"].forEach((id) => { const n = byId(id); while (n.firstChild) n.removeChild(n.firstChild); });
    byId("standings-body").innerHTML = "";
    heads.clear();
    hideTooltip();
  }

  // ── square auto-fit scale ─────────────────────────────────────────────────
  // Half-extent that just contains the currently visible points (dots + their
  // trail window), so the square axes zoom to fit the symbols' spread and
  // expand proportionally as they fan out — while staying square.
  function fitDev(c) {
    let d = MIN_DEV;
    const start = Math.max(0, c - TRAIL_WEEKS + 1);
    for (const s of SECS) for (let k = start; k <= c; k++) {
      if (s.r[k] != null) d = Math.max(d, Math.abs(s.r[k] - 100));
      if (s.m[k] != null) d = Math.max(d, Math.abs(s.m[k] - 100));
    }
    return d * (1 + DEV_PAD);
  }

  // ── RRG chrome + head dots ────────────────────────────────────────────────
  function buildChart() {
    const svg = (rrgSvg = byId("rrg"));
    const L = PAD_L, R = PAD_L + PLOT_W, Tp = PAD_T, B = PAD_T + PLOT_H;

    const quad = (x, y, w, h, c) => el("rect", { x, y, width: w, height: h, fill: c, "fill-opacity": 0.08 }, svg);
    quad(cxp, Tp, R - cxp, cyp - Tp, QUAD_COLORS.Leading);
    quad(cxp, cyp, R - cxp, B - cyp, QUAD_COLORS.Weakening);
    quad(L, cyp, cxp - L, B - cyp, QUAD_COLORS.Lagging);
    quad(L, Tp, cxp - L, cyp - Tp, QUAD_COLORS.Improving);

    for (let i = 1; i < 4; i++) {
      const gx = L + (PLOT_W * i) / 4, gy = Tp + (PLOT_H * i) / 4;
      el("line", { x1: gx, y1: Tp, x2: gx, y2: B, class: "grid-line" }, svg);
      el("line", { x1: L, y1: gy, x2: R, y2: gy, class: "grid-line" }, svg);
    }
    el("rect", { x: L, y: Tp, width: PLOT_W, height: PLOT_H, class: "frame" }, svg);
    el("line", { x1: cxp, y1: Tp, x2: cxp, y2: B, class: "center-line" }, svg);
    el("line", { x1: L, y1: cyp, x2: R, y2: cyp, class: "center-line" }, svg);

    const corner = (text, x, y, anchor, c) => { const t = el("text", { x, y, "text-anchor": anchor, class: "quad-label", fill: c, opacity: 0.8 }, svg); t.textContent = text; };
    corner("LEADING", R - 8, Tp + 15, "end", QUAD_COLORS.Leading);
    corner("IMPROVING", L + 8, Tp + 15, "start", QUAD_COLORS.Improving);
    corner("WEAKENING", R - 8, B - 8, "end", QUAD_COLORS.Weakening);
    corner("LAGGING", L + 8, B - 8, "start", QUAD_COLORS.Lagging);

    let t = el("text", { x: L + PLOT_W / 2, y: B + 34, "text-anchor": "middle", class: "axis-title" }, svg);
    t.textContent = "JdK RS-Ratio  →  relative strength";
    t = el("text", { x: 16, y: Tp + PLOT_H / 2, "text-anchor": "middle", class: "axis-title", transform: `rotate(-90 16 ${Tp + PLOT_H / 2})` }, svg);
    t.textContent = "JdK RS-Momentum  →";

    el("circle", { cx: cxp, cy: cyp, r: 3, fill: "#8b949e" }, svg);
    gTrails = el("g", { id: "trails" }, svg);

    for (const s of SECS) {
      const dot = el("circle", { r: 6, fill: color(s.q[T]), class: "rrg-dot", tabindex: 0, "data-ticker": s.ticker }, svg);
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
      for (let k = start; k <= c; k++) if (s.r[k] != null && s.m[k] != null) pts.push({ x: sx(s.r[k]), y: sy(s.m[k]), q: s.q[k] });
      if (pts.length < 2) continue;
      const d = pts.map((p, i) => (i ? "L" : "M") + p.x.toFixed(1) + " " + p.y.toFixed(1)).join(" ");
      el("path", { d, fill: "none", stroke: color(s.q[c]), "stroke-width": 1.4, "stroke-opacity": 0.3, "stroke-linecap": "round", "stroke-linejoin": "round" }, gTrails);
      for (let i = 0; i < pts.length - 1; i++) {
        const f = i / (pts.length - 1);
        el("circle", { cx: pts[i].x, cy: pts[i].y, r: 1.5 + f * 2.2, fill: color(pts[i].q), "fill-opacity": 0.25 + 0.5 * f }, gTrails);
      }
    }
  }

  // ── SPY strip ───────────────────────────────────────────────────────────
  function buildSpy() {
    const svg = byId("spy");
    const S_T = 14, S_B = 22, H = 120;
    const closes = DATA.benchmark_series.close, reg = DATA.benchmark_series.regime;
    cellW = STRIP_PLOT / (T + 1);
    xAt = (t) => S_L + (t + 0.5) * cellW;
    const valid = closes.filter((v) => v != null);
    const pmin = Math.min(...valid), pmax = Math.max(...valid);
    yPrice = (v) => S_T + ((pmax - v) / (pmax - pmin || 1)) * (H - S_T - S_B);

    const REG_FILL = { bull: [QUAD_COLORS.Leading, 0.06], correction: [QUAD_COLORS.Weakening, 0.09], bear: [QUAD_COLORS.Lagging, 0.11] };
    let runStart = 0;
    for (let t = 1; t <= T + 1; t++) {
      if (t > T || reg[t] !== reg[runStart]) {
        const style = REG_FILL[reg[runStart]];
        if (style) {
          const x0 = S_L + runStart * cellW, x1 = S_L + Math.min(t, T + 1) * cellW;
          el("rect", { x: x0, y: S_T, width: x1 - x0, height: H - S_T - S_B, fill: style[0], "fill-opacity": style[1] }, svg);
        }
        runStart = t;
      }
    }
    let d = "";
    for (let t = 0; t <= T; t++) { if (closes[t] == null) continue; d += (d ? "L" : "M") + xAt(t).toFixed(1) + " " + yPrice(closes[t]).toFixed(1) + " "; }
    el("path", { d: d.trim(), class: "spy-line" }, svg);
    spyPlayhead = el("line", { y1: S_T - 3, y2: H - S_B, class: "playhead" }, svg);
    spyMarker = el("circle", { r: 4, class: "spy-marker" }, svg);
    enableScrub(svg);
  }

  // ── heatmap ───────────────────────────────────────────────────────────────
  function buildHeat() {
    const svg = byId("heat");
    const H = 250, H_T = 8, H_B = 24;
    const rows = [...SECS].sort((a, b) => (b.r[T] ?? -1e9) - (a.r[T] ?? -1e9));
    const rowH = (H - H_T - H_B) / rows.length;
    rows.forEach((s, i) => {
      const y = H_T + i * rowH;
      const lab = el("text", { x: S_L - 6, y: y + rowH / 2 + 3, "text-anchor": "end", class: "hm-row-label" }, svg);
      lab.textContent = s.ticker;
      for (let t = 0; t <= T; t++) el("rect", { x: (S_L + t * cellW).toFixed(2), y: y + 1, width: Math.max(cellW - 0.6, 0.6).toFixed(2), height: rowH - 3, rx: 1.5, fill: color(s.q[t]), "fill-opacity": 0.82 }, svg);
    });
    const nTicks = 6;
    for (let i = 0; i < nTicks; i++) {
      const t = Math.round((i / (nTicks - 1)) * T);
      const tx = el("text", { x: xAt(t), y: H - 8, "text-anchor": "middle", class: "strip-tick" }, svg);
      tx.textContent = DATES[t].slice(2);
    }
    heatPlayhead = el("line", { y1: H_T - 2, y2: H_T + rows.length * rowH, class: "playhead" }, svg);
    enableScrub(svg);
  }

  // ── the one function that moves everything ────────────────────────────────
  function setIndex(c) {
    idx = Math.max(0, Math.min(T, c));
    curDev = fitDev(idx); // refit the square axes to the current spread
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
      // radial label placement: fan labels outward from the center so the cluster spreads
      let ddx = x - cxp, ddy = y - cyp;
      const len = Math.hypot(ddx, ddy) || 1;
      if (len < 6) { ddx = 1; ddy = 0; }
      const ux = ddx / len, uy = ddy / len, off = 11;
      label.setAttribute("x", x + ux * off);
      label.setAttribute("y", y + uy * off + 3.5);
      label.setAttribute("text-anchor", ux >= 0 ? "start" : "end");
    }

    const px = xAt(idx);
    spyPlayhead.setAttribute("x1", px); spyPlayhead.setAttribute("x2", px);
    const close = DATA.benchmark_series.close[idx];
    if (close != null) { spyMarker.removeAttribute("visibility"); spyMarker.setAttribute("cx", px); spyMarker.setAttribute("cy", yPrice(close)); }
    else spyMarker.setAttribute("visibility", "hidden");
    heatPlayhead.setAttribute("x1", px); heatPlayhead.setAttribute("x2", px);

    renderStandings();
    renderMeta();
    const slider = byId("slider");
    if (+slider.value !== idx) slider.value = idx;
    byId("week-label").innerHTML = `week of <strong>${DATES[idx]}</strong>`;
  }

  function renderMeta() {
    const regime = DATA.benchmark_series.regime[idx] || "unknown";
    const cap = regime.charAt(0).toUpperCase() + regime.slice(1);
    byId("meta").innerHTML =
      `<span class="chip"><strong>${DATA.universe.label}</strong></span>` +
      `<span class="chip">vs <strong>${DATA.universe.benchmark}</strong></span>` +
      `<span class="chip regime-${regime}"><span class="swatch"></span>${cap}</span>` +
      `<span class="chip">as of <strong>${DATES[idx]}</strong></span>`;
    byId("chart-note").textContent = `${DATA.universe.benchmark} at center (100, 100)`;
  }

  function renderStandings() {
    const body = byId("standings-body");
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

  // ── tooltip + highlight ───────────────────────────────────────────────────
  const tip = () => byId("tooltip");
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
    document.querySelectorAll(".standings tr[data-ticker]").forEach((row) => row.classList.toggle("hl", on && row.getAttribute("data-ticker") === ticker));
  }

  // ── transport ─────────────────────────────────────────────────────────────
  function play() {
    if (idx >= T) idx = 0;
    playing = true;
    rrgSvg.classList.remove("no-anim");
    const b = byId("play"); b.textContent = "❚❚"; b.title = "Pause";
    step();
  }
  function step() { if (!playing) return; setIndex(idx); if (idx >= T) { pause(); return; } idx++; timer = setTimeout(step, STEP_MS); }
  function pause() { playing = false; clearTimeout(timer); const b = byId("play"); b.textContent = "▶"; b.title = "Play"; }

  function enableScrub(svg) {
    let dragging = false;
    const toIndex = (clientX) => { const r = svg.getBoundingClientRect(); const vbX = ((clientX - r.left) / r.width) * STRIP_W; return Math.round((vbX - S_L) / cellW - 0.5); };
    const go = (clientX) => { pause(); rrgSvg.classList.add("no-anim"); setIndex(toIndex(clientX)); };
    svg.addEventListener("pointerdown", (e) => { dragging = true; svg.setPointerCapture(e.pointerId); go(e.clientX); });
    svg.addEventListener("pointermove", (e) => { if (dragging) go(e.clientX); });
    const end = () => { dragging = false; rrgSvg.classList.remove("no-anim"); };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
  }

  // ── one-time control wiring ───────────────────────────────────────────────
  function wireControlsOnce() {
    const slider = byId("slider");
    slider.addEventListener("input", () => { pause(); rrgSvg.classList.add("no-anim"); setIndex(+slider.value); });
    slider.addEventListener("change", () => rrgSvg.classList.remove("no-anim"));
    byId("play").addEventListener("click", () => (playing ? pause() : play()));
    byId("universe").addEventListener("change", (e) => loadUniverse(e.target.value));

    document.addEventListener("keydown", (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (["input", "select", "textarea", "button", "summary"].includes(tag)) return;
      if (e.key === "ArrowRight") { pause(); rrgSvg.classList.add("no-anim"); setIndex(idx + 1); rrgSvg.classList.remove("no-anim"); e.preventDefault(); }
      else if (e.key === "ArrowLeft") { pause(); rrgSvg.classList.add("no-anim"); setIndex(idx - 1); rrgSvg.classList.remove("no-anim"); e.preventDefault(); }
      else if (e.key === " ") { playing ? pause() : play(); e.preventDefault(); }
    });
  }

  // ── theme ─────────────────────────────────────────────────────────────────
  function initTheme() {
    const btn = byId("theme-toggle");
    const systemTheme = () => (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    const current = () => document.documentElement.getAttribute("data-theme") || systemTheme();
    const apply = (t) => { document.documentElement.setAttribute("data-theme", t); btn.textContent = t === "light" ? "☀️" : "🌙"; try { localStorage.setItem("rrg-theme", t); } catch (e) {} };
    let saved = null;
    try { saved = localStorage.getItem("rrg-theme"); } catch (e) {}
    apply(saved || systemTheme());
    btn.addEventListener("click", () => apply(current() === "dark" ? "light" : "dark"));
  }

  main();
})();
