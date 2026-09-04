"""
Unit tests for immutable Pydantic v2 domain models.
"""

import pytest
from pydantic import ValidationError

from domain.models import (
    SampleSizeTier,
    SampleSizeInfo,
    TradeRecord,
    TradeStats,
    LotCalculationResult,
    MarginSpecs,
    BreakEvenInputs,
    BreakEvenResult,
)


def test_sample_size_info_immutability():
    info = SampleSizeInfo(
        tier=SampleSizeTier.EXPLORATORY,
        count=150,
        label="Sample 100-300 (Testable)",
        badge_color="#ff9800",
        message="Valid sample",
        recommendation="Use half kelly"
    )
    assert info.tier == SampleSizeTier.EXPLORATORY
    assert info.count == 150

    with pytest.raises(ValidationError):
        info.count = 200  # Frozen model cannot be mutated


def test_trade_stats_serialization():
    sample_info = SampleSizeInfo(
        tier=SampleSizeTier.ROBUST,
        count=550,
        label="Sample 500+",
        badge_color="#089981",
        message="Robust sample",
        recommendation="Good"
    )
    stats = TradeStats(
        total_trades=550,
        winning_trades=330,
        losing_trades=220,
        breakeven_trades=0,
        win_rate=0.60,
        loss_rate=0.40,
        avg_win=150.0,
        avg_loss=100.0,
        payoff_ratio=1.5,
        profit_factor=2.25,
        best_win=450.0,
        net_profit=27500.0,
        kelly_full=0.3333,
        kelly_half=0.1667,
        kelly_quarter=0.0833,
        sample_info=sample_info,
        expectancy_r=0.50,
        total_r=275.0,
        monthly_r=12.5,
        monthly_trades=25,
        monthly_pnl=1250.0
    )

    dumped = stats.model_dump()
    assert isinstance(dumped, dict)
    assert dumped["total_trades"] == 550
    assert dumped["win_rate"] == 0.60
    assert dumped["sample_info"]["tier"] == "robust"

    json_str = stats.model_dump_json()
    assert '"total_trades":550' in json_str

    with pytest.raises(ValidationError):
        stats.total_trades = 600


def test_margin_specs_compatibility():
    specs = MarginSpecs(
        margin_rate=0.002,
        margin_per_lot=200.0,
        category_leverage=500.0
    )
    # Attribute access
    assert specs.margin_rate == 0.002
    assert specs.margin_per_lot == 200.0
    assert specs.category_leverage == 500.0

    # Dictionary subscript access
    assert specs["margin_rate"] == 0.002
    assert specs["margin_per_lot"] == 200.0
    assert specs["category_leverage"] == 500.0

    with pytest.raises(ValidationError):
        specs.margin_per_lot = 250.0


def test_break_even_models_immutability():
    inputs = BreakEvenInputs(
        ticket=1001,
        symbol="EURUSD",
        is_buy=True,
        price_open=1.08500,
        volume=0.10,
        commission_total=0.70,
        swap_cost=0.0,
        spread_points=0.00012,
        point=0.00001,
        digits=5,
        tick_size=0.00001,
        tick_value=1.0,
        current_bid=1.08550,
        current_ask=1.08562,
        trade_stops_level=10
    )
    assert inputs.ticket == 1001
    with pytest.raises(ValidationError):
        inputs.ticket = 1002

    res = BreakEvenResult(
        ticket=1001,
        symbol="EURUSD",
        type="BUY",
        price_open=1.08500,
        current_price=1.08550,
        target_be_price=1.08520,
        is_profitable=True,
        commission_cost=0.70,
        swap_cost=0.0,
        spread_dollars=1.20,
        total_cost_absorbed=2.90,
        stops_level=10,
        price_offset=0.00020
    )
    assert res.is_profitable is True
    with pytest.raises(ValidationError):
        res.is_profitable = False
