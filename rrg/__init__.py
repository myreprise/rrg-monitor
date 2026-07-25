"""RRG Monitor — Relative Rotation Graph engine.

Computes JdK RS-Ratio / RS-Momentum for configured universes and exports the
per-week snapshots consumed by the static front-end in ``docs/``.

Implemented across phases:
    calculator.py  — the JdK RS engine            (Phase 1)
    data.py        — standalone OHLCV fetch/cache  (Phase 1)
    export.py      — universes.yaml -> docs/data/  (Phase 1)
"""

__version__ = "0.0.0"  # Phase 0 scaffold
