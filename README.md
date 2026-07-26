# 🧭 RRG Monitor

[![tests](https://github.com/myreprise/rrg-monitor/actions/workflows/tests.yml/badge.svg)](https://github.com/myreprise/rrg-monitor/actions/workflows/tests.yml)
[![live demo](https://img.shields.io/badge/live-demo-2ea44f)](https://myreprise.github.io/rrg-monitor/)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

An interactive, animated **Relative Rotation Graph (RRG)** tracking how capital
rotates across equity sectors and asset classes — a self-contained data pipeline
and static dashboard, refreshed automatically every week.

### ▶ [**Open the live dashboard →**](https://myreprise.github.io/rrg-monitor/)

Press play to watch sectors rotate through the quadrants, scrub the timeline,
switch universes, and toggle light / dark.

---

## What is a Relative Rotation Graph?

An RRG plots each security by two measures **relative to a benchmark**:

- **JdK RS-Ratio** (x-axis) — relative *strength* trend, normalized to ~100
- **JdK RS-Momentum** (y-axis) — the *momentum* of that relative strength, ~100

The plane splits into four quadrants describing where each security is in its
rotation cycle:

| Quadrant | Meaning |
|---|---|
| 🟢 **Leading** | strong and still gaining |
| 🟡 **Weakening** | strong but losing momentum |
| 🔴 **Lagging** | weak and still falling |
| 🔵 **Improving** | weak but gaining momentum |

Capital tends to rotate clockwise: Improving → Leading → Weakening → Lagging.

## The visualization

A **coordinated multi-view dashboard** driven by a single time playhead:

1. **RRG scatter** — the hero view, with comet-tail trails showing each security's recent path.
2. **Benchmark price strip** — the shared time axis and scrubber, with market-regime shading.
3. **Rotation heatmap** — each security's quadrant, week by week — the linear history the scatter hides.
4. **Standings** — a sortable leaderboard of current RS-Ratio / RS-Momentum.

Color encodes **quadrant** (four semantic colors, shared across every view);
identity is carried by labels and position. One playhead links every view —
**play/pause**, a **slider**, **click-drag on either strip**, or the **← → keys**
all move through history together. Hover any dot for its exact values.

## Universes

Defined in [`config/universes.yaml`](config/universes.yaml):

- **SPDR Sectors** — the 11 S&P 500 sector ETFs vs SPY
- **Magnificent 7** — mega-cap growth leaders vs SPY
- **Global / Asset Classes** — regions & asset classes vs global equities (ACWI)

## Architecture

```
rrg/          JdK RS engine + data fetch + JSON exporter (Python)
config/       universe definitions
docs/         GitHub Pages root — static front-end (vanilla JS + SVG) + committed data/*.json
tests/        unit tests for the RS math (schema-contract tested)
.github/      CI (tests) + weekly data-refresh workflows
```

The front-end is deliberately dependency-free — vanilla JavaScript and inline
SVG, no build step and no external libraries — so the whole site is a handful of
static files.

**Data flow:** a weekly GitHub Actions job fetches prices, computes the RS
metrics, and commits `docs/data/<universe>.json` (schema:
[`docs/data/schema.json`](docs/data/schema.json)). The browser renders entirely
client-side — no backend, no database, no secrets.

## Local development

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt   # runtime + test deps
python -m rrg.export                  # regenerate docs/data/*.json from live prices
python -m http.server -d docs 8000    # preview the site at http://localhost:8000
pytest                                # run the test suite
```

## Disclaimer

For educational and illustrative purposes only. Nothing here is investment
advice, a recommendation, or a solicitation to buy or sell any security.

## License

[MIT](LICENSE) © 2026 Brett Lill
