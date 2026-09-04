"""
Domain models for Lot Size Calculation Results and Margin Specifications.
"""

from typing import List
from pydantic import BaseModel, ConfigDict, Field


class MarginSpecs(BaseModel):
    """
    Resolved margin rate and required margin per 1.0 standard lot.
    """
    model_config = ConfigDict(frozen=True)

    margin_rate: float
    margin_per_lot: float
    category_leverage: float = 500.0

    def __getitem__(self, item: str):
        return getattr(self, item)


class LotCalculationResult(BaseModel):
    """
    Complete pre-trade sizing, volume step clamping, risk budget,
    and margin requirement breakdown for a single symbol.
    """
    model_config = ConfigDict(frozen=True)

    symbol: str
    working_capital: float
    deposited_cash: float
    leverage: float
    risk_method: str           # "fractional", "kelly_half", "optimal_f"
    target_risk_pct: float     # e.g. 1.0 = 1.0%
    target_risk_amount: float  # in currency, e.g. $1.00
    sl_pips: float
    pip_value_per_lot: float   # currency value per 1 pip for 1.0 lot

    # Lot sizes
    exact_lot: float           # mathematical unrounded lot
    executable_lot: float      # clamped to volume_min/max and rounded to volume_step

    # Effective metrics
    effective_risk_amount: float
    effective_risk_pct: float
    is_clamped_to_min: bool
    is_clamped_to_max: bool
    min_volume: float
    max_volume: float
    volume_step: float

    # Leverage & Margin
    contract_size: float
    market_price: float
    required_margin: float
    margin_utilization_pct: float  # (required_margin / deposited_cash) * 100
    is_margin_exceeded: bool
    margin_status: str             # "healthy", "warning", "exceeded"

    # Risk Clamping Bounds
    is_floor_clamped: bool = False
    is_ceiling_clamped: bool = False

    # Notes / warnings
    warnings: List[str] = Field(default_factory=list)
