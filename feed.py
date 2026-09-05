"""
MT5 Feed & Market Data Provider exports.
Exposes MT5NativeProvider singleton and provider utilities.
"""

import logging
from typing import Dict, List, Optional, Any

try:
    import MetaTrader5 as mt5
except ImportError:
    mt5 = None

from infrastructure.providers.mock_provider import (
    MOCK_SYMBOLS_SPECS,
    generate_mock_trades_pnl,
)
from infrastructure.providers.mt5_provider import MT5NativeProvider
from domain.models.break_even import BreakEvenInputs
from domain.math.break_even import calculate_break_even_price

logger = logging.getLogger("RiskFeed")

# Primary provider alias and default instance
MT5RiskFeed = MT5NativeProvider
feed = MT5NativeProvider()

__all__ = [
    "MT5RiskFeed",
    "feed",
    "mt5",
    "MOCK_SYMBOLS_SPECS",
    "generate_mock_trades_pnl",
    "BreakEvenInputs",
    "calculate_break_even_price",
]
