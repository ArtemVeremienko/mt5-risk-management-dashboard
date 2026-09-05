"""
Unit tests for MockDataProvider.
Verifies market data emulation, quotes, symbol specs, and simulated execution.
"""

import pytest
from infrastructure.providers.mock_provider import MockDataProvider


def test_mock_provider_account_summary():
    provider = MockDataProvider()
    acc = provider.get_account_summary()
    assert acc.is_live is False
    assert acc.currency == "USD"
    assert acc.balance > 0
    assert acc.equity > 0
    assert acc.free_margin > 0


def test_mock_provider_symbol_specs():
    provider = MockDataProvider()
    specs = provider.get_market_symbols()
    assert len(specs) >= 5

    eurusd = provider.get_symbol_specs("EURUSD")
    assert eurusd is not None
    assert eurusd.symbol == "EURUSD"
    assert eurusd.digits == 5
    assert eurusd.ask > eurusd.bid


def test_mock_provider_order_and_position_lifecycle():
    provider = MockDataProvider()
    # Execute a market BUY order
    res = provider.send_market_order(
        symbol="EURUSD",
        action="BUY",
        volume=0.10,
        sl_pips=20.0,
        rr_ratio=1.5
    )
    assert res["success"] is True
    ticket = res["ticket"]
    assert ticket > 0

    # Verify open positions contain the new ticket
    positions = provider.get_open_positions()
    pos = next((p for p in positions if p.ticket == ticket), None)
    assert pos is not None
    assert pos.symbol == "EURUSD"
    assert pos.volume == 0.10
    assert pos.type == "BUY"

    # Modify SL/TP
    mod_res = provider.modify_position_sltp(ticket=ticket, sl=1.08000, tp=1.09000)
    assert mod_res["success"] is True
    assert mod_res["sl"] == 1.08000

    # Partial close (0.05 lot)
    close_part = provider.close_position(ticket=ticket, volume=0.05)
    assert close_part["success"] is True
    assert close_part["remaining_volume"] == 0.05

    # Full close remaining volume
    close_full = provider.close_position(ticket=ticket)
    assert close_full["success"] is True

    # Confirm position is removed
    assert not any(p.ticket == ticket for p in provider.get_open_positions())
