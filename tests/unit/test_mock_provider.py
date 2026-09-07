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
    assert eurusd.adr_pct is not None and eurusd.adr_pct > 0.0
    assert eurusd.today_range_pct is not None and eurusd.today_range_pct > 0.0
    assert eurusd.room_up_pct is not None and eurusd.room_up_pct >= 0.0
    assert eurusd.room_down_pct is not None and eurusd.room_down_pct >= 0.0

    btcusd = provider.get_symbol_specs("BITCOIN")
    if btcusd:
        assert btcusd.adr_pct is not None and btcusd.adr_pct > eurusd.adr_pct


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


def test_filling_mode_resolution():
    from types import SimpleNamespace
    from unittest.mock import MagicMock
    from infrastructure.providers.mt5_provider import MT5NativeProvider

    provider = MT5NativeProvider(mock_mode=True)

    mock_mt5 = SimpleNamespace(
        ORDER_FILLING_FOK=0,
        ORDER_FILLING_IOC=1,
        ORDER_FILLING_RETURN=2,
    )

    # Symbol with FOK only (bit 0 = 1, e.g. SUGAR / WHEAT)
    info_fok = SimpleNamespace(filling_mode=1)
    modes_fok = provider._resolve_filling_modes(info_fok, mock_mt5)
    assert modes_fok[0] == 0  # FOK should be first

    # Symbol with IOC (bit 1 = 2) and FOK (bit 0 = 1) -> 3 (e.g. EURUSD)
    info_both = SimpleNamespace(filling_mode=3)
    modes_both = provider._resolve_filling_modes(info_both, mock_mt5)
    assert modes_both[0] == 1  # IOC preferred first
    assert modes_both[1] == 0  # FOK second

    # None info fallback
    modes_none = provider._resolve_filling_modes(None, mock_mt5)
    assert modes_none[0] == 1  # IOC default


def test_close_position_stepping_and_validation():
    from types import SimpleNamespace
    from unittest.mock import MagicMock
    from infrastructure.providers.mt5_provider import MT5NativeProvider

    provider = MT5NativeProvider(mock_mode=True)

    pos_sugar = SimpleNamespace(
        ticket=531503145,
        symbol="SUGAR",
        type=1, # SELL
        volume=1.0,
    )
    info_sugar = SimpleNamespace(
        volume_min=1.0,
        volume_step=1.0,
        filling_mode=1,
    )

    mock_mt5 = MagicMock()
    mock_mt5.positions_get.return_value = [pos_sugar]
    mock_mt5.symbol_info.return_value = info_sugar

    provider._get_mt5 = lambda: mock_mt5

    # Attempting to scale out 0.5 lots on a 1.0 lot SUGAR position should fail with clean error
    res = provider._close_position_sync(ticket=531503145, volume=0.5)
    assert res["success"] is False
    assert "below broker minimum" in res["error"]


