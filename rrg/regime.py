"""Self-contained market-regime proxy for the benchmark price strip.

The main project has a richer regime detector, but a public standalone repo
should not depend on it. This is a transparent, rules-based proxy computed
purely from the benchmark's own weekly closes — enough to shade the price strip
behind the RRG (bull / correction / bear).

Rules (evaluated per week, most-severe first):
    bear       : drawdown from the trailing peak <= -20%
    correction : drawdown <= -8%, OR price below its long-term average
    bull       : otherwise
"""
from __future__ import annotations

import pandas as pd

SMA_WEEKS = 40           # ~200 trading days
DRAWDOWN_LOOKBACK = 52   # trailing 1-year peak
CORRECTION_DD = -0.08
BEAR_DD = -0.20


def classify_regime(
    weekly_close: pd.Series,
    sma_weeks: int = SMA_WEEKS,
    drawdown_lookback: int = DRAWDOWN_LOOKBACK,
    correction_dd: float = CORRECTION_DD,
    bear_dd: float = BEAR_DD,
) -> pd.Series:
    """Return a per-week regime label Series ('bull' | 'correction' | 'bear').

    Indexed identically to ``weekly_close``.
    """
    close = pd.Series(weekly_close).astype(float)
    if close.empty:
        return pd.Series(dtype=object)

    sma = close.rolling(sma_weeks, min_periods=1).mean()
    peak = close.rolling(drawdown_lookback, min_periods=1).max()
    drawdown = close / peak - 1.0

    labels = []
    for price, avg, dd in zip(close, sma, drawdown):
        if dd <= bear_dd:
            labels.append("bear")
        elif dd <= correction_dd or price < avg:
            labels.append("correction")
        else:
            labels.append("bull")
    return pd.Series(labels, index=close.index)
