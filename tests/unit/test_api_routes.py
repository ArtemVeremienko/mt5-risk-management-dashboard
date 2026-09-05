"""
Integration tests for Presentation Routers and API endpoints.
Verifies /api/account, /api/symbols, /api/calculate, /api/order/execute, and /api/positions.
"""

import pytest
from fastapi.testclient import TestClient
from app import create_app
from infrastructure.providers.mock_provider import MockDataProvider
from application.market_service import MarketService
from application.execution_service import ExecutionService


@pytest.fixture
def client():
    # Use isolated mock provider for predictable integration tests
    mock_provider = MockDataProvider()
    market_service = MarketService(provider=mock_provider)
    execution_service = ExecutionService(execution_provider=mock_provider, market_service=market_service)

    app = create_app(
        market_service=market_service,
        execution_service=execution_service
    )
    with TestClient(app) as test_client:
        yield test_client


def test_api_account(client):
    res = client.get("/api/account")
    assert res.status_code == 200
    data = res.json()
    assert "balance" in data
    assert "free_margin" in data
    assert data["currency"] == "USD"


def test_api_symbols(client):
    res = client.get("/api/symbols")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, list)
    assert len(data) > 0
    symbols = [s["symbol"] for s in data]
    assert "EURUSD" in symbols


def test_api_calculate(client):
    payload = {
        "symbol_sl_overrides": {"EURUSD": 20.0},
        "working_capital": 5000.0,
        "risk_method": "fractional",
        "custom_risk_pct": 1.5
    }
    res = client.post("/api/calculate", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert "results" in data
    eurusd = next((r for r in data["results"] if r["spec"]["symbol"] == "EURUSD"), None)
    assert eurusd is not None
    assert eurusd["calc"]["executable_lot"] > 0
    assert "effective_risk_pct" in eurusd["calc"]


def test_api_order_and_positions_flow(client):
    # 1. Place order
    order_payload = {
        "symbol": "EURUSD",
        "action": "BUY",
        "volume": 0.08,
        "sl_pips": 20.0,
        "rr_ratio": 1.5,
        "comment": "TestIntegration"
    }
    order_res = client.post("/api/order/execute", json=order_payload)
    assert order_res.status_code == 200
    order_data = order_res.json()
    assert order_data["success"] is True
    ticket = order_data["ticket"]

    # 2. Get positions
    pos_res = client.get("/api/positions")
    assert pos_res.status_code == 200
    pos_data = pos_res.json()
    assert "positions" in pos_data
    assert any(p["ticket"] == ticket for p in pos_data["positions"])

    # 3. Modify position SL/TP
    mod_payload = {
        "ticket": ticket,
        "sl": 1.08100,
        "tp": 1.09200
    }
    mod_res = client.post("/api/position/modify", json=mod_payload)
    assert mod_res.status_code == 200
    assert mod_res.json()["success"] is True

    # 4. Partial close
    close_part_res = client.post("/api/position/close", json={"ticket": ticket, "volume": 0.04})
    assert close_part_res.status_code == 200
    assert close_part_res.json()["success"] is True

    # 5. Bulk close all
    close_all_res = client.post("/api/position/close-all")
    assert close_all_res.status_code == 200
    assert close_all_res.json()["count"] >= 1
