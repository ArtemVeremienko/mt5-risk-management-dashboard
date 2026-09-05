"""
Real-time WebSocket Live Stream endpoint.
Connects frontend to BroadcastHub with client-configurable Turbo Mode (500ms vs 2.0s).
"""

import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends

from application.broadcaster import BroadcastHub
from application.market_service import MarketService
from presentation.dependencies import get_broadcast_hub, get_market_service

logger = logging.getLogger("LiveWebSocket")
router = APIRouter(tags=["WebSocket"])


@router.websocket("/ws/live")
async def websocket_live(
    websocket: WebSocket,
    manager: BroadcastHub = Depends(get_broadcast_hub),
    market_service: MarketService = Depends(get_market_service)
):
    """
    Real-time WebSocket streaming with dynamic client-configurable refresh interval.
    Powered by centralized single-producer BroadcastHub with Turbo Mode (500ms).
    """
    await manager.connect(websocket, initial_interval=2.0)
    try:
        # Send initial symbols, account state, open positions, and trade statistics
        symbols = await market_service.get_market_symbols()
        account = await market_service.get_account_summary()
        positions = await market_service.get_open_positions()
        stats, sample_info = await market_service.get_trade_stats()

        await websocket.send_json({
            "type": "initial_symbols",
            "symbols": [s.model_dump() for s in symbols],
            "account": account.model_dump(),
            "positions": [p.model_dump() for p in positions],
            "trade_stats": stats,
            "sample_info": sample_info
        })

        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                if isinstance(msg, dict):
                    if msg.get("action") == "set_rate":
                        interval_ms = float(msg.get("interval_ms", 2000))
                        await manager.set_interval(websocket, interval_ms / 1000.0)
                        await websocket.send_json({
                            "type": "rate_updated",
                            "interval_ms": interval_ms
                        })
                    elif msg.get("action") == "ping":
                        await websocket.send_json({"type": "pong"})
            except json.JSONDecodeError:
                if data.strip().lower() == "ping":
                    await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.debug(f"WebSocket unexpected error: {e}")
    finally:
        await manager.disconnect(websocket)
