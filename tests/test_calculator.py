"""Unit tests for the JdK RS engine (rrg/calculator.py)."""
from __future__ import annotations

import numpy as np
import pandas as pd

from rrg.calculator import compute_rs, quadrant_for, to_weekly
from tests.conftest import make_daily


# ── quadrant_for ─────────────────────────────────────────────────────────────

def test_quadrant_labels():
    assert quadrant_for(101, 101) == "Leading"
    assert quadrant_for(101, 99) == "Weakening"
    assert quadrant_for(99, 99) == "Lagging"
    assert quadrant_for(99, 101) == "Improving"


def test_quadrant_boundary_is_inclusive():
    # Exactly 100 counts as the strong side (>= 100).
    assert quadrant_for(100, 100) == "Leading"


def test_quadrant_nan_is_unknown():
    assert quadrant_for(float("nan"), 100) == "unknown"
    assert quadrant_for(100, float("nan")) == "unknown"


# ── to_weekly ────────────────────────────────────────────────────────────────

def test_to_weekly_resamples_to_fridays():
    daily = make_daily(periods=60)["close"]
    weekly = to_weekly(daily)
    assert len(weekly) < len(daily)
    assert all(ts.weekday() == 4 for ts in weekly.index)  # all Fridays
    # last weekly value equals the last daily close of that week
    assert weekly.iloc[-1] == daily.iloc[-1]


def test_to_weekly_passthrough_when_already_weekly():
    idx = pd.bdate_range("2023-01-06", periods=20, freq="W-FRI")
    weekly = pd.Series(np.arange(20, dtype=float), index=idx)
    out = to_weekly(weekly)
    assert len(out) == len(weekly)
    assert out.equals(weekly)


def test_to_weekly_empty():
    assert to_weekly(pd.Series(dtype=float)).empty


# ── compute_rs ───────────────────────────────────────────────────────────────

def test_identity_series_sits_at_100_leading():
    """A security identical to the benchmark has RS-Ratio == RS-Momentum == 100."""
    w = to_weekly(make_daily(periods=400)["close"])
    rs = compute_rs(w, w)
    last = rs.dropna().iloc[-1]
    assert abs(last["rs_ratio"] - 100.0) < 1e-6
    assert abs(last["rs_momentum"] - 100.0) < 1e-6
    assert last["quadrant"] == "Leading"  # boundary is inclusive


def test_steady_outperformer_is_leading():
    bench = to_weekly(make_daily(periods=500, drift=0.0002)["close"])
    strong = to_weekly(make_daily(periods=500, drift=0.0009)["close"])
    rs = compute_rs(strong, bench).dropna()
    last = rs.iloc[-1]
    assert last["rs_ratio"] > 100.0
    assert last["rs_momentum"] > 100.0
    assert last["quadrant"] == "Leading"


def test_steady_underperformer_is_lagging():
    bench = to_weekly(make_daily(periods=500, drift=0.0009)["close"])
    weak = to_weekly(make_daily(periods=500, drift=0.0002)["close"])
    rs = compute_rs(weak, bench).dropna()
    last = rs.iloc[-1]
    assert last["rs_ratio"] < 100.0
    assert last["rs_momentum"] < 100.0
    assert last["quadrant"] == "Lagging"


def test_no_overlap_returns_empty_with_columns():
    a = pd.Series([1.0, 2.0], index=pd.to_datetime(["2023-01-06", "2023-01-13"]))
    b = pd.Series([1.0, 2.0], index=pd.to_datetime(["2024-01-05", "2024-01-12"]))
    rs = compute_rs(a, b)
    assert rs.empty
    assert list(rs.columns) == ["rs_line", "rs_ratio", "rs_momentum", "quadrant"]


def test_momentum_roc_warmup_is_nan():
    """RS-Momentum needs `roc_period` prior weeks; the first ones are NaN."""
    w = to_weekly(make_daily(periods=200)["close"])
    rs = compute_rs(w, w)
    assert rs["rs_momentum"].iloc[:4].isna().all()
