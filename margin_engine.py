"""
Institutional Margin Engine & Broker Specification Resolver.
Backward-compatibility adapter forwarding to domain.math.margin_engine.
"""

from domain.math.margin_engine import (
    get_category_leverage,
    resolve_margin_specs,
    calculate_broker_margin,
    calculate_required_margin,
)

__all__ = [
    "get_category_leverage",
    "resolve_margin_specs",
    "calculate_broker_margin",
    "calculate_required_margin",
]
