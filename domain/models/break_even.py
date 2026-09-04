"""
Domain models for Universal Cost-Absorbing Break-Even Sizing and Qualification.
"""

from pydantic import BaseModel, ConfigDict, Field


class BreakEvenInputs(BaseModel):
    """
    Typed input parameters for calculating a universal break-even price.
    Pure data contract completely isolated from MetaTrader 5 C-extension structures.
    """
    model_config = ConfigDict(frozen=True)

    ticket: int
    symbol: str
    is_buy: bool
    price_open: float
    volume: float
    commission_total: float = 0.0       # Entry & exit commission + broker fees
    swap_cost: float = 0.0              # Accumulated negative financing/overnight swap
    spread_points: float = 0.0          # Current spread in points (ask - bid)
    point: float = 0.00001              # Smallest price increment
    digits: int = 5                     # Price precision decimals
    tick_size: float = 0.00001          # Minimum price step
    tick_value: float = 1.0             # Currency value per tick for 1.0 standard lot
    current_bid: float = 0.0
    current_ask: float = 0.0
    trade_stops_level: int = 0          # Minimum distance in points allowed by broker
    safety_pad_pips: float = 0.5        # Minimum extra buffer above raw break-even
    min_safety_pad_dollars: float = 1.00 # Cash floor for safety pad


class BreakEvenResult(BaseModel):
    """
    Calculated break-even target price, cost breakdown, and profitability status.
    """
    model_config = ConfigDict(frozen=True)

    success: bool = True
    ticket: int
    symbol: str
    type: str                           # "BUY" or "SELL"
    price_open: float
    current_price: float
    target_be_price: float
    is_profitable: bool
    commission_cost: float
    swap_cost: float
    spread_dollars: float
    total_cost_absorbed: float
    stops_level: int
    price_offset: float
    message: str = ""
