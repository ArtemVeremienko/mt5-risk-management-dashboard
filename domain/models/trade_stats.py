"""
Domain models for Trade Statistics, Sample Size Reliability Tiers, and Trade Accounting.
"""

from enum import Enum
from typing import Optional
from pydantic import ConfigDict
from domain.models.base import DomainModel


class SampleSizeTier(str, Enum):
    INFORMATIONAL = "informational"    # < 100 trades
    EXPLORATORY = "exploratory"        # 100 - 300 trades
    MODERATE = "moderate"              # 300 - 500 trades
    ROBUST = "robust"                  # 500+ trades


class SampleSizeInfo(DomainModel):
    model_config = ConfigDict(frozen=True, arbitrary_types_allowed=True)

    tier: SampleSizeTier
    count: int
    label: str
    badge_color: str
    message: str
    recommendation: str


class TradeRecord(DomainModel):
    """
    Normalized record of a closed position aggregated from raw broker deals.
    """
    model_config = ConfigDict(frozen=True)

    position_id: int
    symbol: str
    order_type: str = "BUY"
    volume: float = 0.0
    open_price: float = 0.0
    close_price: float = 0.0
    open_time: Optional[int] = None
    close_time: Optional[int] = None
    pnl: float = 0.0
    commission: float = 0.0
    swap: float = 0.0
    magic: int = 0
    comment: str = ""


class TradeStats(DomainModel):
    """
    Aggregated statistical profile of historical trading performance,
    including Van Tharp R-multiples, expectancy, and Kelly Criterion fractions.
    """
    model_config = ConfigDict(frozen=True)

    total_trades: int
    winning_trades: int
    losing_trades: int
    breakeven_trades: int
    win_rate: float            # 0.0 - 1.0 (e.g. 0.55 = 55%)
    loss_rate: float           # 0.0 - 1.0
    avg_win: float             # average win in currency
    avg_loss: float            # average loss in currency (positive number)
    payoff_ratio: float        # avg_win / avg_loss (b)
    profit_factor: float       # gross profit / gross loss
    best_win: float            # largest single win
    net_profit: float          # total net profit
    kelly_full: float          # f* (can be negative if negative expectancy)
    kelly_half: float          # f* / 2
    kelly_quarter: float       # f* / 4
    sample_info: SampleSizeInfo
    expectancy_r: float = 0.0  # (win_rate * payoff_ratio) - loss_rate
    total_r: float = 0.0       # net_profit / avg_loss
    monthly_r: float = 0.0     # monthly_pnl / avg_loss
    monthly_trades: int = 0    # trades closed in current calendar month
    monthly_pnl: float = 0.0   # net closed PnL in current calendar month
