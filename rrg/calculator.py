"""JdK RS-Ratio & RS-Momentum — the two canonical RRG axes.

Both metrics are normalized around 100:
    > 100  → outperforming / accelerating
    < 100  → underperforming / decelerating

Quadrants
---------
    Leading   : RS-Ratio >= 100  AND  RS-Momentum >= 100
    Weakening : RS-Ratio >= 100  AND  RS-Momentum <  100
    Lagging   : RS-Ratio <  100  AND  RS-Momentum <  100
    Improving : RS-Ratio <  100  AND  RS-Momentum >= 100

Methodology (weekly data), matching the StockCharts.com RRG:
    1. RS line   = security_close / benchmark_close
    2. RS-Ratio  = (RS_line / EMA(RS_line, 52)) * 100
    3. RS-Mom    = EMA( 4-week ROC of RS-Ratio, 4 ) + 100

This module is self-contained (pandas only) — no project dependencies — so it
can live in a standalone public repo.
"""
from __future__ import annotations

import pandas as pd

# ── Parameters (weekly bars) ────────────────────────────────────────────────
RS_RATIO_EMA_PERIOD = 52     # ~1 trading year
RS_MOMENTUM_ROC_PERIOD = 4   # 4-week rate of change
RS_MOMENTUM_EMA_PERIOD = 4   # smoothing on the ROC

QUADRANT_LABELS = {
    (True, True): "Leading",
    (True, False): "Weakening",
    (False, False): "Lagging",
    (False, True): "Improving",
}


def to_weekly(close: pd.Series) -> pd.Series:
    """Resample a daily close series to weekly (Friday-anchored) last close.

    A series that is already weekly (average gap >= 5 calendar days) passes
    through unchanged, so callers may hand in either daily or weekly data.
    """
    s = pd.Series(close).dropna().astype(float)
    if s.empty:
        return s
    if not isinstance(s.index, pd.DatetimeIndex):
        s.index = pd.to_datetime(s.index)
    if len(s) > 1:
        avg_gap = (s.index[-1] - s.index[0]).days / (len(s) - 1)
        if avg_gap >= 5:
            return s
    return s.resample("W-FRI").last().dropna()


def quadrant_for(rs_ratio: float, rs_momentum: float) -> str:
    """Return the quadrant label for a single (RS-Ratio, RS-Momentum) point."""
    if pd.isna(rs_ratio) or pd.isna(rs_momentum):
        return "unknown"
    return QUADRANT_LABELS[(rs_ratio >= 100.0, rs_momentum >= 100.0)]


def compute_rs(
    security_weekly: pd.Series,
    benchmark_weekly: pd.Series,
    ema_period: int = RS_RATIO_EMA_PERIOD,
    roc_period: int = RS_MOMENTUM_ROC_PERIOD,
    momentum_ema_period: int = RS_MOMENTUM_EMA_PERIOD,
) -> pd.DataFrame:
    """Compute RS-Ratio / RS-Momentum / quadrant for one security vs a benchmark.

    Both inputs are weekly close series. They are aligned on their common dates.
    Returns a DataFrame indexed by date with columns:
        rs_line, rs_ratio, rs_momentum, quadrant
    (empty DataFrame with those columns if there is no overlap).
    """
    cols = ["rs_line", "rs_ratio", "rs_momentum", "quadrant"]
    combined = pd.DataFrame(
        {"security": security_weekly, "benchmark": benchmark_weekly}
    ).dropna()
    if combined.empty:
        return pd.DataFrame(columns=cols)

    rs_line = combined["security"] / combined["benchmark"]

    rs_ema = rs_line.ewm(span=ema_period, adjust=False).mean()
    rs_ratio = (rs_line / rs_ema) * 100.0

    roc = ((rs_ratio / rs_ratio.shift(roc_period)) - 1.0) * 100.0
    rs_momentum = roc.ewm(span=momentum_ema_period, adjust=False).mean() + 100.0

    df = pd.DataFrame(
        {"rs_line": rs_line, "rs_ratio": rs_ratio, "rs_momentum": rs_momentum}
    )
    df["quadrant"] = [
        quadrant_for(r, m) for r, m in zip(df["rs_ratio"], df["rs_momentum"])
    ]
    return df
