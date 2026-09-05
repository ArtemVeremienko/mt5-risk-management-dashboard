"""
Execution Application Service.
Orchestrates trade execution, position modifications, liquidations,
and post-trade WebSocket event broadcasts.
"""

import asyncio
import time
from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field

from infrastructure.providers.base import IExecutionProvider
from application.broadcaster import BroadcastHub
from application.market_service import MarketService


class OrderExecuteRequest(BaseModel):
    """Request payload for dispatching an instant market order."""
    symbol: str
    action: str = Field(..., description="'BUY' or 'SELL'")
    volume: float = Field(..., ge=0.001, description="Lot size")
    sl_pips: float = Field(..., gt=0, description="Stop loss in pips")
    rr_ratio: float = Field(default=1.0, ge=0.0, description="Risk:Reward ratio for Take Profit (0 for no TP)")
    comment: str = Field(default="RiskDashboard", description="Trade comment")


class PositionCloseRequest(BaseModel):
    """Request payload for closing an open position."""
    ticket: int
    volume: Optional[float] = Field(default=None, description="Optional volume to close (for partial liquidation)")


class PositionModifyRequest(BaseModel):
    """Request payload for modifying Stop Loss and Take Profit."""
    ticket: int
    sl: Optional[float] = Field(default=None, description="New absolute Stop Loss price")
    tp: Optional[float] = Field(default=None, description="New absolute Take Profit price")


class ExecutionService:
    """
    Application Service for trade execution and liquidation operations.
    """

    def __init__(
        self,
        execution_provider: IExecutionProvider,
        broadcaster: Optional[BroadcastHub] = None,
        market_service: Optional[MarketService] = None
    ):
        self._provider = execution_provider
        self._broadcaster = broadcaster
        self._market_service = market_service

    @property
    def provider(self) -> IExecutionProvider:
        return self._provider

    async def _notify_trade_event(self, include_stats: bool = False) -> None:
        """Triggers real-time snapshot broadcast to connected clients."""
        if not self._broadcaster:
            return

        payload: Dict[str, Any] = {
            "type": "symbols_update",
            "timestamp": time.time()
        }

        if include_stats and self._market_service:
            try:
                stats, sample_info = await self._market_service.get_trade_stats()
                payload["trade_stats"] = stats
                payload["sample_info"] = sample_info
            except Exception:
                pass

        asyncio.create_task(self._broadcaster.broadcast(payload))

    async def send_market_order(self, req: OrderExecuteRequest) -> Dict[str, Any]:
        res = await asyncio.to_thread(
            self._provider.send_market_order,
            symbol=req.symbol,
            action=req.action,
            volume=req.volume,
            sl_pips=req.sl_pips,
            rr_ratio=req.rr_ratio,
            comment=req.comment
        )
        if res.get("success"):
            await self._notify_trade_event(include_stats=False)
        return res

    async def modify_position_sltp(self, req: PositionModifyRequest) -> Dict[str, Any]:
        res = await asyncio.to_thread(
            self._provider.modify_position_sltp,
            ticket=req.ticket,
            sl=req.sl,
            tp=req.tp
        )
        if res.get("success"):
            await self._notify_trade_event(include_stats=False)
        return res

    async def close_position(self, req: PositionCloseRequest) -> Dict[str, Any]:
        res = await asyncio.to_thread(
            self._provider.close_position,
            ticket=req.ticket,
            volume=req.volume
        )
        if res.get("success"):
            await self._notify_trade_event(include_stats=True)
        return res

    async def close_all_positions(self) -> Dict[str, Any]:
        results = await asyncio.to_thread(self._provider.close_all_positions)
        await self._notify_trade_event(include_stats=True)
        return {"results": results, "count": len(results)}

    async def break_even_all_positions(self) -> Dict[str, Any]:
        res = await asyncio.to_thread(self._provider.break_even_all_positions)
        await self._notify_trade_event(include_stats=False)
        return res

    async def close_50_all_positions(self) -> Dict[str, Any]:
        res = await asyncio.to_thread(self._provider.close_50_all_positions)
        await self._notify_trade_event(include_stats=True)
        return res
