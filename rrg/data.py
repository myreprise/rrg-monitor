"""Standalone daily-OHLCV fetch with a light local cache.

Uses yfinance directly (no project data layer) so the repo stands alone. A
per-symbol parquet cache under ``data/raw/`` speeds up local iteration; CI runs
with an empty cache and always fetches fresh.
"""
from __future__ import annotations

import logging
import os
import time
from pathlib import Path

import pandas as pd

logger = logging.getLogger(__name__)

CACHE_DIR = Path(os.environ.get("RRG_CACHE_DIR", "data/raw"))
DEFAULT_MAX_AGE = 6 * 3600  # seconds
_COLUMNS = ["open", "high", "low", "close", "volume"]


def _cache_file(symbol: str) -> Path:
    return CACHE_DIR / f"{symbol.upper()}.parquet"


def _download(symbol: str, start: str, end: str, retries: int = 2) -> pd.DataFrame:
    """Download daily, split/dividend-adjusted OHLCV for one symbol via yfinance."""
    import yfinance as yf

    last_err: Exception | None = None
    for attempt in range(retries + 1):
        try:
            raw = yf.Ticker(symbol).history(
                start=start, end=end, interval="1d", auto_adjust=True
            )
            if raw is None or raw.empty:
                return pd.DataFrame(columns=_COLUMNS)
            raw = raw.rename(columns=str.lower)
            missing = [c for c in _COLUMNS if c not in raw.columns]
            if missing:
                raise ValueError(f"{symbol}: missing columns {missing}")
            raw = raw[_COLUMNS].copy()
            raw.index = pd.to_datetime(raw.index).tz_localize(None)
            raw.index.name = "date"
            return raw
        except Exception as exc:  # pragma: no cover - network variability
            last_err = exc
            logger.warning("fetch %s failed (attempt %d): %s", symbol, attempt + 1, exc)
            time.sleep(1.5 * (attempt + 1))
    logger.error("fetch %s gave up: %s", symbol, last_err)
    return pd.DataFrame(columns=_COLUMNS)


def fetch_daily(
    symbol: str, start: str, end: str, max_age: float = DEFAULT_MAX_AGE
) -> pd.DataFrame:
    """Return daily OHLCV for ``symbol`` between ``start`` and ``end`` (inclusive).

    Serves from the parquet cache when it is fresher than ``max_age``; otherwise
    downloads and refreshes the cache.
    """
    fp = _cache_file(symbol)
    if fp.exists() and (time.time() - fp.stat().st_mtime) < max_age:
        try:
            cached = pd.read_parquet(fp)
            return cached.loc[str(start): str(end)]
        except Exception as exc:  # pragma: no cover
            logger.warning("cache read %s failed: %s", symbol, exc)

    df = _download(symbol, start, end)
    if not df.empty:
        try:
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            df.to_parquet(fp)
        except Exception as exc:  # pragma: no cover
            logger.warning("cache write %s failed: %s", symbol, exc)
    return df


def fetch_many(
    symbols: list[str], start: str, end: str, max_age: float = DEFAULT_MAX_AGE
) -> dict[str, pd.DataFrame]:
    """Fetch daily OHLCV for several symbols. Returns {symbol: DataFrame}."""
    out: dict[str, pd.DataFrame] = {}
    for sym in dict.fromkeys(symbols):  # dedupe, preserve order
        df = fetch_daily(sym, start, end, max_age=max_age)
        if df.empty:
            logger.warning("no data for %s", sym)
        out[sym] = df
    return out
