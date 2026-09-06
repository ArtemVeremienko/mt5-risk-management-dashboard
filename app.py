"""
FastAPI application for MT5 Risk Management & Dynamic Lot Sizing Dashboard.
Modularized with FastAPI Depends() Dependency Injection, Clean Architecture Services,
and Centralized Pub/Sub BroadcastHub.
"""

import os
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles

from config.settings import AppSettings
from infrastructure.providers.mt5_provider import MT5NativeProvider
from infrastructure.providers.mock_provider import MockDataProvider
from application.broadcaster import BroadcastHub
from application.market_service import (
    MarketService,
    CalculationRequest,
    ManualStatsRequest,
    compute_effective_sl_pips,
)
from application.execution_service import (
    ExecutionService,
    OrderExecuteRequest,
    PositionCloseRequest,
    PositionModifyRequest,
)
from application.liquidation_service import LiquidationService, FlattenSummary
from presentation.routers import (
    account_router,
    symbols_router,
    trades_router,
    orders_router,
    positions_router,
)
from presentation.websocket import websocket_router
from feed import MT5RiskFeed

logger = logging.getLogger("RiskApp")
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
DIST_DIR = os.path.join(STATIC_DIR, "dist")
if not os.path.exists(STATIC_DIR):
    os.makedirs(STATIC_DIR, exist_ok=True)

# Backward-compatibility singletons
feed = MT5RiskFeed()
manager = BroadcastHub()


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = getattr(app.state, "settings", None) or AppSettings()
    provider = getattr(app.state, "market_provider", None) or (MockDataProvider() if settings.mock_mode else feed)
    broadcaster = getattr(app.state, "broadcast_hub", None) or manager
    market_service = getattr(app.state, "market_service", None) or MarketService(provider)
    execution_service = getattr(app.state, "execution_service", None) or ExecutionService(provider, broadcaster, market_service)
    liquidation_service = getattr(app.state, "liquidation_service", None) or LiquidationService(provider, broadcaster, market_service)

    # Attach to app.state for FastAPI Depends() injection
    app.state.settings = settings
    app.state.market_provider = provider
    app.state.execution_provider = provider
    app.state.broadcast_hub = broadcaster
    app.state.market_service = market_service
    app.state.execution_service = execution_service
    app.state.liquidation_service = liquidation_service

    # 1. Proactive background volatility cache worker (refreshes 14D ADR/ATR every 15 minutes)
    async def volatility_cache_task():
        await market_service.refresh_volatility_cache()
        while True:
            await asyncio.sleep(settings.volatility_ttl_seconds)
            try:
                await market_service.refresh_volatility_cache()
            except Exception as e:
                logger.error(f"Error refreshing volatility cache: {e}")

    # 2. Centralized single-producer market broadcast loop
    last_pos_count = -1
    last_stats_time = asyncio.get_event_loop().time()

    async def produce_live_snapshot():
        nonlocal last_pos_count, last_stats_time
        symbols = await market_service.get_market_symbols()
        account = await market_service.get_account_summary()
        positions = await market_service.get_open_positions()
        curr_pos_count = len(positions)
        now_time = asyncio.get_event_loop().time()

        payload = {
            "type": "symbols_update",
            "symbols": [s.model_dump() for s in symbols],
            "account": account.model_dump(),
            "positions": [p.model_dump() for p in positions],
            "timestamp": now_time
        }

        if (last_pos_count != -1 and curr_pos_count < last_pos_count) or (now_time - last_stats_time >= 5.0):
            stats, sample_info = await market_service.get_trade_stats()
            payload["trade_stats"] = stats
            payload["sample_info"] = sample_info
            last_stats_time = now_time

        last_pos_count = curr_pos_count
        return payload

    vol_task = asyncio.create_task(volatility_cache_task())
    broadcast_task = asyncio.create_task(broadcaster.run_loop(produce_live_snapshot))
    yield
    vol_task.cancel()
    broadcaster.stop()
    broadcast_task.cancel()
    provider.shutdown()
    feed.shutdown()


def create_app(
    market_service: Optional[MarketService] = None,
    execution_service: Optional[ExecutionService] = None,
    liquidation_service: Optional[LiquidationService] = None,
    market_provider: Optional[Any] = None,
    execution_provider: Optional[Any] = None,
    broadcast_hub: Optional[BroadcastHub] = None,
    settings: Optional[AppSettings] = None
) -> FastAPI:
    """Application factory configuring routers, lifespan, and static assets."""
    application = FastAPI(
        title="MT5 Risk Management & Lot Sizing Dashboard",
        description="Dynamic Multi-Model Risk Matrix with Kelly Criterion, Turbo Mode & Real-Time Caching",
        lifespan=lifespan
    )

    app_settings = settings or AppSettings()
    prov = market_provider or (market_service.provider if market_service else (MockDataProvider() if app_settings.mock_mode else feed))
    broadcaster = broadcast_hub or manager
    m_service = market_service or MarketService(prov)
    e_service = execution_service or ExecutionService(prov, broadcaster, m_service)
    l_service = liquidation_service or LiquidationService(prov, broadcaster, m_service)

    # Attach to application.state for FastAPI Depends()
    application.state.settings = app_settings
    application.state.market_provider = prov
    application.state.execution_provider = execution_provider or prov
    application.state.broadcast_hub = broadcaster
    application.state.market_service = m_service
    application.state.execution_service = e_service
    application.state.liquidation_service = l_service

    # Register presentation routers
    application.include_router(account_router)
    application.include_router(symbols_router)
    application.include_router(trades_router)
    application.include_router(orders_router)
    application.include_router(positions_router)
    application.include_router(websocket_router)

    # Mount static assets
    if os.path.exists(DIST_DIR):
        assets_dir = os.path.join(DIST_DIR, "assets")
        if os.path.exists(assets_dir):
            application.mount("/assets", StaticFiles(directory=assets_dir), name="assets")
        application.mount("/static", StaticFiles(directory=DIST_DIR), name="static")

    @application.get("/", response_class=HTMLResponse)
    async def serve_index():
        dist_index = os.path.join(DIST_DIR, "index.html")
        if os.path.exists(dist_index):
            return FileResponse(dist_index)
        return HTMLResponse(
            "<!DOCTYPE html><html><body style='background:#0b0e14;color:#f0f3fa;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;'>"
            "<div style='text-align:center;'>"
            "<h1>MT5 Risk Management Terminal</h1>"
            "<p style='color:#9598a1;'>Compiled frontend not found. Please build the frontend bundle:</p>"
            "<pre style='background:#1e222d;padding:12px 20px;border-radius:6px;border:1px solid #2a2e39;'>cd frontend &amp;&amp; npm run build</pre>"
            "</div></body></html>",
            status_code=503
        )

    return application


app = create_app()
