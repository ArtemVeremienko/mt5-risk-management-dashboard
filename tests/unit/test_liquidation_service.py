"""
Unit tests for LiquidationService and Smart Flatten ($0 Delta) Engine.
"""

import pytest
from infrastructure.providers.mock_provider import MockDataProvider
from application.market_service import MarketService
from application.execution_service import ExecutionService, OrderExecuteRequest
from application.liquidation_service import LiquidationService


@pytest.mark.anyio
async def test_liquidation_service_flatten_all():
    provider = MockDataProvider()
    market_service = MarketService(provider=provider)
    execution_service = ExecutionService(execution_provider=provider, market_service=market_service)
    liquidation_service = LiquidationService(execution_provider=provider, market_service=market_service)

    # 1. Open 2 positions
    res1 = await execution_service.send_market_order(OrderExecuteRequest(symbol="EURUSD", action="BUY", volume=0.05, sl_pips=20.0))
    res2 = await execution_service.send_market_order(OrderExecuteRequest(symbol="GBPUSD", action="SELL", volume=0.08, sl_pips=30.0))
    assert res1["success"] is True
    assert res2["success"] is True

    positions = provider.get_open_positions()
    assert len(positions) == 2

    # 2. Add pending order to mock provider
    provider._pending_orders[99901] = {"ticket": 99901, "symbol": "EURUSD", "type": "BUY_LIMIT", "volume": 0.10}
    assert len(provider._pending_orders) == 1

    # 3. Execute smart flatten
    summary = await liquidation_service.flatten_all()
    assert summary["success"] is True
    assert summary["orders_cancelled"] == 1
    assert summary["positions_closed"] == 2

    # Verify true $0 Delta exposure
    assert len(provider.get_open_positions()) == 0
    assert len(provider._pending_orders) == 0


@pytest.mark.anyio
async def test_liquidation_service_close_all_positions_only():
    provider = MockDataProvider()
    liquidation_service = LiquidationService(execution_provider=provider)

    # Open positions
    provider.send_market_order(symbol="EURUSD", action="BUY", volume=0.05, sl_pips=20.0)
    provider._pending_orders[88801] = {"ticket": 88801, "symbol": "EURUSD", "type": "SELL_LIMIT", "volume": 0.05}

    # Close positions only
    res = await liquidation_service.close_all_positions()
    assert res["success"] is True
    assert res["closed_count"] == 1
    # Pending order should still remain intact
    assert len(provider._pending_orders) == 1
    assert len(provider.get_open_positions()) == 0


@pytest.mark.anyio
async def test_liquidation_service_cancel_order():
    provider = MockDataProvider()
    liquidation_service = LiquidationService(execution_provider=provider)

    provider._pending_orders[77701] = {"ticket": 77701, "symbol": "EURUSD", "type": "BUY_STOP", "volume": 0.02}
    
    # Cancel valid order
    cancel_res = await liquidation_service.cancel_order(77701)
    assert cancel_res["success"] is True
    assert 77701 not in provider._pending_orders

    # Cancel non-existent order
    fail_res = await liquidation_service.cancel_order(12345)
    assert fail_res["success"] is False
