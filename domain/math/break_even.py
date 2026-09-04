"""
Pure mathematical engine for Universal Cost-Absorbing Break-Even Price Calculation.

Decoupled from MetaTrader 5 IPC and C-extension types.
Factors in:
1. Entry & exit commission + broker fees
2. Accumulated overnight swap/financing in account currency
3. Real-time market spread cost
4. Nominal safety pad (0.5 pip or $1.00 minimum equivalent)
5. Broker minimum trade_stops_level distance
"""

from domain.models.break_even import BreakEvenInputs, BreakEvenResult


def calculate_break_even_price(params: BreakEvenInputs) -> BreakEvenResult:
    """
    Computes exact cost-absorbing break-even price for an open market position.
    Returns BreakEvenResult with target price, cost breakdown, and eligibility flag.
    """
    digits = max(0, int(params.digits))
    point = float(params.point) if params.point > 0 else 0.00001
    tick_size = float(params.tick_size) if params.tick_size > 0 else point
    tick_val = float(params.tick_value) if params.tick_value > 0 else 1.0
    vol = max(0.0, float(params.volume))

    pip_multiplier = 10.0 if digits in (3, 5) else 1.0
    pip_size = point * pip_multiplier

    # Point value per position volume: 1 point price movement = dollars
    point_val_for_pos = (tick_val / tick_size) * vol if (tick_size > 0 and vol > 0) else (10.0 * vol)

    # 1. Commission & broker fees
    commission_cost = abs(float(params.commission_total))

    # 2. Accumulated overnight financing / swap
    swap_cost = abs(float(params.swap_cost))

    # 3. Live Spread Cost in account deposit currency
    spread_pts = max(0.0, float(params.spread_points))
    spread_dollars = (spread_pts / tick_size) * tick_val * vol if tick_size > 0 else (5.0 * vol)

    # 4. Nominal Safety Pad ($1.00 minimum or safety_pad_pips equivalent)
    pip_val_for_pos = (pip_size / tick_size) * tick_val * vol if tick_size > 0 else (10.0 * vol)
    safety_pad_dollars = max(float(params.min_safety_pad_dollars), float(params.safety_pad_pips) * pip_val_for_pos)

    # Total cost to absorb before position is true zero-risk
    total_cost_dollars = commission_cost + swap_cost + spread_dollars + safety_pad_dollars

    # Price offset required to cover all costs
    if point_val_for_pos > 0:
        price_offset = total_cost_dollars / point_val_for_pos
    else:
        price_offset = spread_pts + (params.safety_pad_pips * pip_size)

    # Compute target BE price & profitability qualification
    stops_distance = params.trade_stops_level * point
    if params.is_buy:
        target_be = float(params.price_open) + price_offset
        current_price = float(params.current_bid)
        # Position can only move to BE if current market bid is safely above target BE + stops_level
        is_profitable = (current_price > target_be + stops_distance)
    else:
        target_be = float(params.price_open) - price_offset
        current_price = float(params.current_ask)
        # For short position, current ask must be safely below target BE - stops_level
        is_profitable = (current_price < target_be - stops_distance)

    rounded_be = round(target_be, digits)

    return BreakEvenResult(
        success=True,
        ticket=params.ticket,
        symbol=params.symbol,
        type="BUY" if params.is_buy else "SELL",
        price_open=float(params.price_open),
        current_price=current_price,
        target_be_price=rounded_be,
        is_profitable=is_profitable,
        commission_cost=round(commission_cost, 2),
        swap_cost=round(swap_cost, 2),
        spread_dollars=round(spread_dollars, 2),
        total_cost_absorbed=round(total_cost_dollars, 2),
        stops_level=params.trade_stops_level,
        price_offset=round(price_offset, digits),
        message=""
    )
