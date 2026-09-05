"""
Unit tests for MarketService and ExecutionService application layer.
"""

import pytest
from infrastructure.providers.mock_provider import MockDataProvider
from application.market_service import MarketService, CalculationRequest
from application.execution_service import ExecutionService, OrderExecuteRequest, PositionModifyRequest, PositionCloseRequest


@pytest.mark.anyio
async def test_market_service_account_and_symbols():
    provider = MockDataProvider()
    service = MarketService(provider=provider)

    acc = await service.get_account_summary()
    assert acc.is_live is False
    assert acc.free_margin > 0

    symbols = await service.get_market_symbols()
    assert len(symbols) >= 5

    spec = await service.get_symbol_specs("EURUSD")
    assert spec is not None
    assert spec.symbol == "EURUSD"


@pytest.mark.anyio
async def test_market_service_calculate():
    provider = MockDataProvider()
    service = MarketService(provider=provider)

    req = CalculationRequest(
        symbol_sl_overrides={"EURUSD": 20.0},
        working_capital=10000.0,
        risk_method="fractional",
        custom_risk_pct=1.0
    )
    matrix = await service.calculate_risk_matrix(req)
    assert "results" in matrix
    assert len(matrix["results"]) >= 5
    eurusd_res = next((r for r in matrix["results"] if r["spec"]["symbol"] == "EURUSD"), None)
    assert eurusd_res is not None
    assert eurusd_res["calc"]["executable_lot"] > 0
    assert "effective_risk_pct" in eurusd_res["calc"]


@pytest.mark.anyio
async def test_execution_service_order_flow():
    provider = MockDataProvider()
    service = ExecutionService(execution_provider=provider)

    # Place order
    req = OrderExecuteRequest(
        symbol="EURUSD",
        action="BUY",
        volume=0.05,
        sl_pips=25.0,
        rr_ratio=2.0
    )
    res = await service.send_market_order(req)
    assert res["success"] is True
    ticket = res["ticket"]

    # Modify
    mod_req = PositionModifyRequest(ticket=ticket, sl=1.08200)
    mod_res = await service.modify_position_sltp(mod_req)
    assert mod_res["success"] is True

    # Close partial
    close_req = PositionCloseRequest(ticket=ticket, volume=0.02)
    close_res = await service.close_position(close_req)
    assert close_res["success"] is True
    assert close_res["remaining_volume"] == 0.03

    # Close remaining
    close_all = await service.close_all_positions()
    assert close_all["count"] >= 1
