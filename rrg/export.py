"""Export RRG data to docs/data/<universe>.json (the front-end's input).

Pipeline per universe:
    fetch daily OHLCV  ->  weekly closes  ->  RS-Ratio / RS-Momentum / quadrant
    ->  align every series to one shared weekly date index  ->  JSON.

The output conforms to docs/data/schema.json (frozen v1.0). ``build_payload`` is
pure (takes already-fetched frames) so it can be unit-tested without a network.

Run:
    python -m rrg.export                 # all universes -> docs/data/
    python -m rrg.export --universe mag7 # just one
"""
from __future__ import annotations

import argparse
import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import yaml

from rrg.calculator import (
    RS_MOMENTUM_ROC_PERIOD,
    RS_RATIO_EMA_PERIOD,
    compute_rs,
    to_weekly,
)
from rrg.regime import classify_regime

logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG = REPO_ROOT / "config" / "universes.yaml"
DEFAULT_OUT = REPO_ROOT / "docs" / "data"
SCHEMA_VERSION = "1.0"

DEFAULT_WEEKS = 156   # ~3 years computed
DEFAULT_TAIL = 52     # ~1 year emitted (the visible timeline window)


# ── helpers ─────────────────────────────────────────────────────────────────

def _round_list(series: pd.Series, ndigits: int) -> list:
    """Series -> JSON-safe list, NaN -> None, rounded."""
    out = []
    for v in series:
        out.append(None if pd.isna(v) else round(float(v), ndigits))
    return out


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ── pure payload builder (no network) ────────────────────────────────────────

def build_payload(
    universe_id: str,
    cfg: dict,
    frames: dict[str, pd.DataFrame],
    weeks: int = DEFAULT_WEEKS,
    tail: int = DEFAULT_TAIL,
    generated_utc: str | None = None,
) -> dict:
    """Assemble one universe's JSON payload from already-fetched daily frames.

    Args:
        universe_id: slug / file name (e.g. "sectors").
        cfg: the universe config block (label, benchmark, tickers, names, ...).
        frames: {symbol: daily OHLCV DataFrame} for benchmark + all tickers.
        weeks: compute window (weekly bars).
        tail: number of most-recent weeks emitted.
    """
    benchmark = cfg["benchmark"]
    names = cfg.get("names", {}) or {}

    bench_df = frames.get(benchmark)
    if bench_df is None or bench_df.empty:
        raise ValueError(f"[{universe_id}] no benchmark data for {benchmark}")

    bench_weekly = to_weekly(bench_df["close"])
    if len(bench_weekly) > weeks:
        bench_weekly = bench_weekly.iloc[-weeks:]
    if bench_weekly.empty:
        raise ValueError(f"[{universe_id}] benchmark weekly series is empty")

    # Per-security RS metrics (indexed by each security's own weekly dates).
    rs_by_ticker: dict[str, pd.DataFrame] = {}
    for ticker in cfg["tickers"]:
        df = frames.get(ticker)
        if df is None or df.empty:
            logger.warning("[%s] no data for %s — skipping", universe_id, ticker)
            continue
        rs = compute_rs(to_weekly(df["close"]), bench_weekly)
        if rs.empty:
            logger.warning("[%s] no RS overlap for %s — skipping", universe_id, ticker)
            continue
        rs_by_ticker[ticker] = rs

    if not rs_by_ticker:
        raise ValueError(f"[{universe_id}] no securities produced RS data")

    # One shared date index: the last `tail` weeks of the benchmark.
    dates = bench_weekly.index[-tail:]

    regime = classify_regime(bench_weekly).reindex(dates)

    securities = []
    for ticker, rs in rs_by_ticker.items():
        rs_ratio = rs["rs_ratio"].reindex(dates)
        rs_momentum = rs["rs_momentum"].reindex(dates)
        quadrant = rs["quadrant"].reindex(dates)
        securities.append(
            {
                "ticker": ticker,
                "name": names.get(ticker, ticker),
                "rs_ratio": _round_list(rs_ratio, 4),
                "rs_momentum": _round_list(rs_momentum, 4),
                "quadrant": [q if isinstance(q, str) else "unknown" for q in quadrant],
            }
        )

    return {
        "schema_version": SCHEMA_VERSION,
        "universe": {
            "id": universe_id,
            "label": cfg.get("label", universe_id),
            "benchmark": benchmark,
            "description": cfg.get("description", ""),
        },
        "generated_utc": generated_utc or _utc_now_iso(),
        "params": {
            "weeks": int(weeks),
            "tail": int(len(dates)),
            "rs_ratio_ema": RS_RATIO_EMA_PERIOD,
            "momentum_roc": RS_MOMENTUM_ROC_PERIOD,
        },
        "dates": [d.strftime("%Y-%m-%d") for d in dates],
        "benchmark_series": {
            "close": _round_list(bench_weekly.reindex(dates), 4),
            "regime": [r if isinstance(r, str) else "unknown" for r in regime],
        },
        "securities": securities,
    }


# ── network + orchestration ──────────────────────────────────────────────────

def _fetch_window(weeks: int) -> tuple[str, str]:
    warmup_days = (RS_RATIO_EMA_PERIOD + 10) * 7
    end = datetime.now()
    start = end - timedelta(days=weeks * 7 + warmup_days)
    return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")


def run(
    config_path: Path = DEFAULT_CONFIG,
    out_dir: Path = DEFAULT_OUT,
    weeks: int = DEFAULT_WEEKS,
    tail: int = DEFAULT_TAIL,
    only: list[str] | None = None,
    max_age: float | None = None,
) -> list[Path]:
    """Fetch, build, and write JSON for the selected universes. Returns paths."""
    from rrg import data  # local import so build_payload stays network-free

    cfg_all = yaml.safe_load(Path(config_path).read_text())["universes"]
    selected = {k: v for k, v in cfg_all.items() if not only or k in only}
    if not selected:
        raise ValueError(f"no matching universes in {config_path} (asked: {only})")

    start, end = _fetch_window(weeks)
    fetch_kwargs = {} if max_age is None else {"max_age": max_age}
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    generated = _utc_now_iso()

    written: list[Path] = []
    for uid, cfg in selected.items():
        symbols = [cfg["benchmark"], *cfg["tickers"]]
        logger.info("[%s] fetching %d symbols", uid, len(set(symbols)))
        frames = data.fetch_many(symbols, start, end, **fetch_kwargs)
        payload = build_payload(uid, cfg, frames, weeks, tail, generated_utc=generated)
        path = out_dir / f"{uid}.json"
        path.write_text(json.dumps(payload, indent=2) + "\n")
        logger.info(
            "[%s] wrote %s (%d securities, %d weeks)",
            uid, path, len(payload["securities"]), len(payload["dates"]),
        )
        written.append(path)
    return written


def main() -> None:
    ap = argparse.ArgumentParser(description="Export RRG data to docs/data/*.json")
    ap.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--weeks", type=int, default=DEFAULT_WEEKS)
    ap.add_argument("--tail", type=int, default=DEFAULT_TAIL)
    ap.add_argument(
        "--universe", action="append", dest="only",
        help="Limit to this universe id (repeatable). Default: all.",
    )
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    paths = run(args.config, args.out, args.weeks, args.tail, args.only)
    print(f"Wrote {len(paths)} file(s): " + ", ".join(p.name for p in paths))


if __name__ == "__main__":
    main()
