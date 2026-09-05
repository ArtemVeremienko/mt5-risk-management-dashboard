"""
Position domain model representing active MT5 market positions.
"""

from typing import Optional
from pydantic import Field, ConfigDict
from domain.models.base import DomainModel
from domain.models.symbol import StepRule


class Position(DomainModel):
    """
    Immutable representation of an active MT5 open market position.
    """
    model_config = ConfigDict(frozen=True)

    ticket: int = Field(..., description="Unique position ticket ID")
    symbol: str = Field(..., description="Financial instrument symbol")
    type: str = Field(..., description="Position direction: 'BUY' or 'SELL'")
    volume: float = Field(..., description="Position volume in lots")
    price_open: float = Field(..., description="Open entry price")
    price_current: float = Field(..., description="Current live market price")
    sl: float = Field(default=0.0, description="Stop Loss price level")
    tp: float = Field(default=0.0, description="Take Profit price level")
    initial_sl: float = Field(default=0.0, description="Initial Stop Loss level at trade inception")
    is_sl_in_profit: bool = Field(default=False, description="True if SL is beyond break-even price")
    locked_r: float = Field(default=0.0, description="R-multiple locked in by current Stop Loss")
    profit: float = Field(default=0.0, description="Unrealized floating profit/loss in deposit currency")
    swap: float = Field(default=0.0, description="Accrued rollover swap fee")
    pnl_pips: float = Field(default=0.0, description="Floating gain/loss in pips")
    r_multiple: Optional[float] = Field(default=None, description="Current floating R-multiple")
    comment: str = Field(default="", description="Trade comment / strategy tag")
    magic: int = Field(default=0, description="Expert Advisor magic number")
    time: int = Field(default=0, description="Unix timestamp of position opening")
    digits: int = Field(default=5, description="Symbol pricing digits")
    pip_size: float = Field(default=0.0001, description="Size of 1 pip in price units")
    step_rule: Optional[StepRule] = Field(default=None, description="Stepping rules for SL/TP modification")
