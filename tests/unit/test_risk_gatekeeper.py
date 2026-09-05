"""
Unit tests for PreTradeGatekeeper and ExecutionService Risk Pipeline.
Verifies spread blowout guard, margin health check, volume step constraints,
and 300ms duplicate-order debouncing.
"""

import pytest
import time
from domain.safety.gatekeeper import PreTradeGatekeeper
from infrastructure.providers.mock_provider import MockDataProvider
from application.market_service import MarketService
from application.execution_service import ExecutionService, OrderExecuteRequest


def test_gatekeeper_spread_validation():
    # Normal spread
    ok, err = PreTradeGatekeeper.validate_spread(current_spread_pips=1.8, median_spread_pips=1.5, max_multiplier=2.5)
    assert ok is True
    assert err is None

    # Spread blowout (current > 2.5 * 1.5 = 3.75)
    ok, err = PreTradeGatekeeper.validate_spread(current_spread_pips=4.2, median_spread_pips=1.5, max_multiplier=2.5)
    assert ok is False
    assert "Spread blowout" in err


def test_gatekeeper_margin_health_validation():
    # Normal required margin ($35 out of $1,000 free margin)
    ok, err = PreTradeGatekeeper.validate_margin_health(required_margin=35.0, free_margin=1000.0, max_margin_usage_ratio=0.95)
    assert ok is True
    assert err is None

    # Exceeds 95% buffer ($960 out of $1,000 free margin)
    ok, err = PreTradeGatekeeper.validate_margin_health(required_margin=960.0, free_margin=1000.0, max_margin_usage_ratio=0.95)
    assert ok is False
    assert "exceeds 95% of free margin" in err

    # Non-positive free margin
    ok, err = PreTradeGatekeeper.validate_margin_health(required_margin=10.0, free_margin=0.0)
    assert ok is False


def test_gatekeeper_volume_limits():
    # Valid volume
    ok, err = PreTradeGatekeeper.validate_volume_limits(volume=0.05, volume_min=0.01, volume_max=100.0, volume_step=0.01)
    assert ok is True

    # Below minimum
    ok, err = PreTradeGatekeeper.validate_volume_limits(volume=0.005, volume_min=0.01, volume_max=100.0, volume_step=0.01)
    assert ok is False
    assert "below broker minimum" in err

    # Above maximum
    ok, err = PreTradeGatekeeper.validate_volume_limits(volume=150.0, volume_min=0.01, volume_max=100.0, volume_step=0.01)
    assert ok is False
    assert "exceeds broker maximum" in err

    # Misaligned volume step
    ok, err = PreTradeGatekeeper.validate_volume_limits(volume=0.055, volume_min=0.01, volume_max=100.0, volume_step=0.01)
    assert ok is False
    assert "not a valid multiple of step size" in err


@pytest.mark.anyio
async def test_execution_service_order_debouncing():
    provider = MockDataProvider()
    market_service = MarketService(provider=provider)
    execution_service = ExecutionService(
        execution_provider=provider,
        market_service=market_service,
        debounce_window_seconds=0.30
    )

    req = OrderExecuteRequest(
        symbol="EURUSD",
        action="BUY",
        volume=0.05,
        sl_pips=25.0
    )

    # 1. First execution succeeds
    res1 = await execution_service.send_market_order(req)
    assert res1["success"] is True

    # 2. Immediate duplicate order within 300ms is debounced
    res2 = await execution_service.send_market_order(req)
    assert res2["success"] is False
    assert res2["code"] == "ORDER_DEBOUNCED"


@pytest.mark.anyio
async def test_execution_service_idempotency_cache():
    provider = MockDataProvider()
    market_service = MarketService(provider=provider)
    execution_service = ExecutionService(
        execution_provider=provider,
        market_service=market_service
    )

    req = OrderExecuteRequest(
        symbol="EURUSD",
        action="BUY",
        volume=0.05,
        sl_pips=25.0,
        client_order_id="TEST-IDEM-001"
    )

    # First dispatch executes
    res1 = await execution_service.send_market_order(req)
    assert res1["success"] is True
    ticket = res1["ticket"]

    # Re-dispatch with same client_order_id returns cached response
    res2 = await execution_service.send_market_order(req)
    assert res2["success"] is True
    assert res2["ticket"] == ticket
