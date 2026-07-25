"""Unit tests for the self-contained regime proxy (rrg/regime.py)."""
from __future__ import annotations

import numpy as np
import pandas as pd

from rrg.regime import classify_regime


def _weekly(values) -> pd.Series:
    idx = pd.bdate_range("2022-01-07", periods=len(values), freq="W-FRI")
    return pd.Series(np.asarray(values, dtype=float), index=idx)


def test_steady_uptrend_is_bull():
    s = _weekly(100.0 * (1.005 ** np.arange(120)))
    out = classify_regime(s)
    assert out.iloc[-1] == "bull"
    # a strong uptrend should be overwhelmingly bull
    assert (out == "bull").mean() > 0.8


def test_deep_drawdown_is_bear():
    up = 100.0 * (1.004 ** np.arange(80))
    peak = up[-1]
    down = np.linspace(peak, peak * 0.75, 20)  # -25% from the peak
    out = classify_regime(_weekly(np.concatenate([up, down])))
    assert out.iloc[-1] == "bear"


def test_shallow_dip_is_correction_not_bear():
    up = 100.0 * (1.004 ** np.arange(80))
    peak = up[-1]
    down = np.linspace(peak, peak * 0.88, 12)  # -12% from the peak
    out = classify_regime(_weekly(np.concatenate([up, down])))
    assert out.iloc[-1] == "correction"


def test_labels_are_from_allowed_set():
    s = _weekly(100.0 + np.sin(np.arange(60)) * 5)
    assert set(classify_regime(s).unique()) <= {"bull", "correction", "bear"}


def test_empty_input():
    assert classify_regime(pd.Series(dtype=float)).empty
