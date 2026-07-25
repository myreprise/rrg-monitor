"""Shared test fixtures — synthetic daily OHLCV, no network."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest


def make_daily(periods: int = 900, start: str = "2022-01-03", drift: float = 0.0003) -> pd.DataFrame:
    """Deterministic daily OHLCV with steady compound drift (no randomness)."""
    idx = pd.bdate_range(start=start, periods=periods)
    close = 100.0 * (1.0 + drift) ** np.arange(periods)
    df = pd.DataFrame(
        {
            "open": close,
            "high": close * 1.01,
            "low": close * 0.99,
            "close": close,
            "volume": np.full(periods, 1_000_000.0),
        },
        index=idx,
    )
    df.index.name = "date"
    return df


@pytest.fixture
def daily_factory():
    return make_daily
