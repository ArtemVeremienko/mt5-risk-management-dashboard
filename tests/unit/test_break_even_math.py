"""
Unit tests for the pure Break-Even mathematical calculation engine.
"""

from domain.models.break_even import BreakEvenInputs
from domain.math.break_even import calculate_break_even_price


def test_buy_break_even_calculation():
    # Long position: Open at 1.08500, volume 0.10 lot
    # Commission = $0.70, Swap = -$0.50, Spread = 12 points (0.00012)
    # 0.10 lot EURUSD: Point value = $1.00 per pip (10 points = 1 pip)
    # Spread in cash = 1.2 pips * $1.00 = $1.20
    # Safety pad = max($1.00, 0.5 pip * $1.00) = $1.00
    # Total cost = 0.70 + 0.50 + 1.20 + 1.00 = $3.40
    # Price offset required = 3.40 / 10,000 = 0.00034
    # Target BE price = 1.08500 + 0.00034 = 1.08534
    inputs = BreakEvenInputs(
        ticket=12345,
        symbol="EURUSD",
        is_buy=True,
        price_open=1.08500,
        volume=0.10,
        commission_total=0.70,
        swap_cost=0.50,
        spread_points=0.00012,
        point=0.00001,
        digits=5,
        tick_size=0.00001,
        tick_value=1.0,
        current_bid=1.08560,
        current_ask=1.08572,
        trade_stops_level=10,  # 10 points = 0.00010
        safety_pad_pips=0.5,
        min_safety_pad_dollars=1.00
    )

    res = calculate_break_even_price(inputs)
    assert res.success is True
    assert res.type == "BUY"
    assert abs(res.target_be_price - 1.08534) < 0.00002
    assert res.total_cost_absorbed == 3.40
    # Current bid (1.08560) is above target BE (1.08534) + stops level (0.00010 = 1.08544) -> Profitable!
    assert res.is_profitable is True


def test_sell_break_even_calculation():
    # Short position: Open at 1.08500, volume 0.10 lot
    # Target BE should be BELOW open price
    inputs = BreakEvenInputs(
        ticket=67890,
        symbol="EURUSD",
        is_buy=False,
        price_open=1.08500,
        volume=0.10,
        commission_total=0.70,
        swap_cost=0.50,
        spread_points=0.00012,
        point=0.00001,
        digits=5,
        tick_size=0.00001,
        tick_value=1.0,
        current_bid=1.08440,
        current_ask=1.08452,
        trade_stops_level=10,
        safety_pad_pips=0.5,
        min_safety_pad_dollars=1.00
    )

    res = calculate_break_even_price(inputs)
    assert res.success is True
    assert res.type == "SELL"
    # Target BE should be approx 1.08500 - 0.00034 = 1.08466
    assert abs(res.target_be_price - 1.08466) < 0.00002
    # Current ask (1.08452) is below target BE (1.08466) - stops level (0.00010 = 1.08456) -> Profitable!
    assert res.is_profitable is True


def test_break_even_unprofitable_stops_level():
    # Position in profit by only 1 pip, not enough to cover costs + stops distance
    inputs = BreakEvenInputs(
        ticket=11111,
        symbol="EURUSD",
        is_buy=True,
        price_open=1.08500,
        volume=0.10,
        commission_total=1.00,
        swap_cost=1.00,
        spread_points=0.00015,
        point=0.00001,
        digits=5,
        tick_size=0.00001,
        tick_value=1.0,
        current_bid=1.08510,  # Only +1 pip
        current_ask=1.08525,
        trade_stops_level=20, # 20 points distance required
        safety_pad_pips=0.5,
        min_safety_pad_dollars=1.00
    )

    res = calculate_break_even_price(inputs)
    assert res.is_profitable is False
