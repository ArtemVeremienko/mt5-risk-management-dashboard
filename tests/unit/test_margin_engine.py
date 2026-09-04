"""
Unit tests for the Unified Institutional Margin Engine.
"""

import pytest
from domain.math.margin_engine import (
    get_category_leverage,
    resolve_margin_specs,
    calculate_broker_margin,
    calculate_required_margin,
)


def test_category_leverage_caps():
    # Forex: Uses account leverage
    assert get_category_leverage("Forex Majors", "EURUSD", 2000.0) == 2000.0
    assert get_category_leverage("Forex Minors", "GBPJPY", 500.0) == 500.0

    # Metals: Capped at 1:888
    assert get_category_leverage("Metals", "XAUUSD", 2000.0) == 888.0
    assert get_category_leverage("Metals", "SILVER", 500.0) == 500.0

    # Energies: Capped at 1:500 or 1:200 for natural gas
    assert get_category_leverage("Energies", "BRENT", 2000.0) == 500.0
    assert get_category_leverage("Energies", "NAT.GAS", 2000.0) == 200.0

    # Indices: Capped at 1:500
    assert get_category_leverage("Indices", ".US500Cash", 2000.0) == 500.0
    assert get_category_leverage("Indices", ".DE40Cash", 2000.0) == 500.0

    # Equities / Single-Stock CFDs: 4% regulatory CFD margin (1:25)
    assert get_category_leverage("Equities", "AAPL.US", 2000.0) == 25.0
    assert get_category_leverage("Stocks", "AMD.O", 500.0) == 25.0

    # Crypto: Capped at 1:200
    assert get_category_leverage("Crypto", "BTCUSD", 2000.0) == 200.0


def test_cfd_unscaled_anomaly_shielding():
    # Broker returning corrupt raw_order_margin=0.09 for BRENT at price=75.0, contract_size=1000
    # Notional = 75,000; 0.09 would imply 1:833,333 leverage.
    specs = resolve_margin_specs(
        symbol="BRENT",
        category="Energies",
        contract_size=1000.0,
        ask=75.0,
        acc_leverage=2000.0,
        raw_order_margin=0.09
    )
    # Shielding should reject 0.09 and enforce 1:500 category leverage (rate=0.002)
    assert specs.margin_rate == 0.002
    assert specs.margin_per_lot == 150.0  # 75,000 * 0.002 = $150


def test_required_margin_dynamic_fx_conversion():
    # JP225 with dynamic conversion rate
    # lots=0.01, contract_size=1.0, price=66329, conversion_rate=1/160.0 (~0.00625)
    # notional JPY = 663.29 * 0.00625 = $4.15
    margin_dynamic = calculate_required_margin(
        lots=0.01,
        contract_size=1.0,
        market_price=66329.0,
        leverage=300.0,
        symbol=".JP225Cash",
        conversion_rate=1.0 / 160.0
    )
    assert abs(margin_dynamic - 4.15) < 0.1

    # JP225 without dynamic conversion rate (uses clean default ~1/159.5)
    margin_default = calculate_required_margin(
        lots=0.01,
        contract_size=1.0,
        market_price=66329.0,
        leverage=300.0,
        symbol=".JP225Cash"
    )
    assert abs(margin_default - 4.16) < 0.2


def test_broker_margin_user_leverage_scaling():
    # Standard EURUSD margin at 1:2000 leverage: Notional = 100,000 * 1.0850 = 108,500
    # Margin = 108,500 / 2000 = $54.25 per lot
    margin_2000 = calculate_broker_margin(
        symbol="EURUSD",
        lots=1.0,
        price=1.0850,
        acc_leverage=2000.0,
        category="Forex Majors",
        contract_size=100000.0
    )
    assert abs(margin_2000 - 54.25) < 0.5

    # Scaled with custom user leverage 1:500 (margin should quadruple)
    margin_500 = calculate_broker_margin(
        symbol="EURUSD",
        lots=1.0,
        price=1.0850,
        acc_leverage=2000.0,
        user_leverage=500.0,
        category="Forex Majors",
        contract_size=100000.0
    )
    assert abs(margin_500 - (margin_2000 * 4.0)) < 1.0
