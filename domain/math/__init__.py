"""
Domain Math Package.
Exports all pure mathematical and quantitative risk calculation engines.
"""

from domain.math.margin_engine import (
    get_category_leverage,
    resolve_margin_specs,
    calculate_broker_margin,
    calculate_required_margin,
)
from domain.math.risk_models import (
    evaluate_sample_size,
    calculate_kelly_fraction,
    calculate_trade_statistics,
    clamp_lot_to_broker_specs,
    calculate_lot_for_symbol,
)
from domain.math.break_even import (
    calculate_break_even_price,
)

__all__ = [
    "get_category_leverage",
    "resolve_margin_specs",
    "calculate_broker_margin",
    "calculate_required_margin",
    "evaluate_sample_size",
    "calculate_kelly_fraction",
    "calculate_trade_statistics",
    "clamp_lot_to_broker_specs",
    "calculate_lot_for_symbol",
    "calculate_break_even_price",
]
