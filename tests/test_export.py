"""Tests for the pure payload builder + the frozen JSON schema contract."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from rrg.export import build_payload
from tests.conftest import make_daily

REPO_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = REPO_ROOT / "docs" / "data" / "schema.json"

CFG = {
    "label": "Test Universe",
    "benchmark": "BENCH",
    "description": "synthetic",
    "tickers": ["STRONG", "WEAK"],
    "names": {"STRONG": "Strong Co", "WEAK": "Weak Co"},
}

QUADRANTS = {"Leading", "Weakening", "Lagging", "Improving", "unknown"}
REGIMES = {"bull", "correction", "bear", "unknown"}


def _frames():
    return {
        "BENCH": make_daily(periods=900, drift=0.0004),
        "STRONG": make_daily(periods=900, drift=0.0009),
        "WEAK": make_daily(periods=900, drift=0.0001),
    }


def _payload(tail=52):
    return build_payload(
        "test", CFG, _frames(), weeks=156, tail=tail,
        generated_utc="2026-07-25T00:00:00Z",
    )


def test_payload_top_level_shape():
    p = _payload()
    assert p["schema_version"] == "1.0"
    assert p["universe"] == {
        "id": "test", "label": "Test Universe",
        "benchmark": "BENCH", "description": "synthetic",
    }
    assert p["generated_utc"] == "2026-07-25T00:00:00Z"
    assert p["params"]["rs_ratio_ema"] == 52
    assert p["params"]["momentum_roc"] == 4


def test_all_series_aligned_to_dates():
    p = _payload(tail=52)
    T = len(p["dates"])
    assert T == 52
    assert p["params"]["tail"] == T
    assert len(p["benchmark_series"]["close"]) == T
    assert len(p["benchmark_series"]["regime"]) == T
    for sec in p["securities"]:
        assert len(sec["rs_ratio"]) == T
        assert len(sec["rs_momentum"]) == T
        assert len(sec["quadrant"]) == T


def test_enumerations_are_valid():
    p = _payload()
    assert set(p["benchmark_series"]["regime"]) <= REGIMES
    for sec in p["securities"]:
        assert set(sec["quadrant"]) <= QUADRANTS


def test_relative_strength_direction_is_correct():
    """End-to-end sanity: the outperformer leads, the underperformer lags."""
    p = _payload()
    by_ticker = {s["ticker"]: s for s in p["securities"]}
    assert by_ticker["STRONG"]["quadrant"][-1] == "Leading"
    assert by_ticker["WEAK"]["quadrant"][-1] == "Lagging"


def test_dates_are_sorted_iso():
    dates = _payload()["dates"]
    assert dates == sorted(dates)
    assert all(len(d) == 10 and d[4] == "-" for d in dates)


def test_missing_benchmark_raises():
    with pytest.raises(ValueError):
        build_payload("test", CFG, {"STRONG": make_daily()}, weeks=156, tail=52)


def test_payload_conforms_to_frozen_schema():
    jsonschema = pytest.importorskip("jsonschema")
    schema = json.loads(SCHEMA_PATH.read_text())
    jsonschema.validate(instance=_payload(), schema=schema)
