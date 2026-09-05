"""
FastAPI Dependency Injection Providers.
Resolves Application Services and Infrastructure Components stored in app.state.
Enables clean test overriding via app.dependency_overrides.
Supports both HTTP Requests and WebSockets via Starlette HTTPConnection.
"""

from typing import Union
from starlette.requests import HTTPConnection
from application.market_service import MarketService
from application.execution_service import ExecutionService
from application.liquidation_service import LiquidationService
from application.broadcaster import BroadcastHub
from config.settings import AppSettings
from infrastructure.providers.mock_provider import MockDataProvider

_default_settings = AppSettings()
_default_hub = BroadcastHub()
_default_provider = MockDataProvider()
_default_market_service = MarketService(_default_provider)
_default_execution_service = ExecutionService(_default_provider, _default_hub, _default_market_service)
_default_liquidation_service = LiquidationService(_default_provider, _default_hub, _default_market_service)


def get_settings(conn: HTTPConnection) -> AppSettings:
    """Returns application settings."""
    if hasattr(conn.app, "state") and hasattr(conn.app.state, "settings"):
        return conn.app.state.settings
    return _default_settings


def get_broadcast_hub(conn: HTTPConnection) -> BroadcastHub:
    """Returns centralized WebSocket broadcast hub."""
    if hasattr(conn.app, "state") and hasattr(conn.app.state, "broadcast_hub"):
        return conn.app.state.broadcast_hub
    return _default_hub


def get_market_service(conn: HTTPConnection) -> MarketService:
    """Returns market data application service."""
    if hasattr(conn.app, "state") and hasattr(conn.app.state, "market_service"):
        return conn.app.state.market_service
    return _default_market_service


def get_execution_service(conn: HTTPConnection) -> ExecutionService:
    """Returns trade execution application service."""
    if hasattr(conn.app, "state") and hasattr(conn.app.state, "execution_service"):
        return conn.app.state.execution_service
    return _default_execution_service


def get_liquidation_service(conn: HTTPConnection) -> LiquidationService:
    """Returns liquidation application service."""
    if hasattr(conn.app, "state") and hasattr(conn.app.state, "liquidation_service"):
        return conn.app.state.liquidation_service
    return _default_liquidation_service

