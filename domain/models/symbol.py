"""
Symbol and instrument specification domain models.
"""

from typing import Optional
from pydantic import ConfigDict
from domain.models.base import DomainModel


class StepRule(DomainModel):
    """
    Price and stop level stepping rules for UI controls.
    """
    model_config = ConfigDict(frozen=True)

    pip_size: float
    digits: int
    normal_step: float
    fast_step: float
    precision_step: float
    unit_label: str
    stops_level_pips: Optional[float] = None


class SymbolSpec(DomainModel):
    """
    Immutable representation of an MT5 instrument specification and market state.
    """
    model_config = ConfigDict(frozen=True)

    symbol: str
    category: str = "Forex Majors"
    bid: float = 1.0850
    ask: float = 1.0852
    digits: int = 5
    point: float = 0.00001
    pip_size: float = 0.0001
    trade_contract_size: float = 100000.0
    trade_tick_value: float = 1.0
    trade_tick_size: float = 0.00001
    volume_min: float = 0.01
    volume_max: float = 100.0
    volume_step: float = 0.01
    pip_value_per_lot: float = 10.0
    spread_pips: float = 2.0
    adr_14_pips: float = 60.0
    atr_14_pips: float = 65.0
    currency_base: Optional[str] = "USD"
    currency_profit: Optional[str] = "USD"
    currency_margin: Optional[str] = "USD"
    bid_display: Optional[str] = None
    ask_display: Optional[str] = None
    spread_display: Optional[str] = None
    adr_display: Optional[str] = None
    atr_display: Optional[str] = None
    step_rule: Optional[StepRule] = None
    margin_per_lot: Optional[float] = None
    margin_rate: Optional[float] = None
