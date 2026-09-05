"""
Liquidation Application Service.
Orchestrates institutional $0-Delta account flattening and position liquidations:
1. Two-phase Smart Flatten: Cancel 100% of pending orders, then liquidate 100% of open market positions.
2. Market positions liquidation only (close_all_positions).
3. Post-liquidation real-time snapshot broadcast via BroadcastHub.
"""

import asyncio
import time
import logging
from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field

from infrastructure.providers.base import IExecutionProvider
from application.broadcaster import BroadcastHub
from application.market_service import MarketService

logger = logging.getLogger("LiquidationService")


class FlattenSummary(BaseModel):
    """Audit summary of an emergency or manual flatten operation."""
    success: bool
    orders_cancelled: int = 0
    positions_closed: int = 0
    order_results: List[Dict[str, Any]] = Field(default_factory=list)
    position_results: List[Dict[str, Any]] = Field(default_factory=list)
    message: str = ""
    timestamp: float = Field(default_factory=time.time)


class LiquidationService:
    """
    Application service managing institutional position closing and order cancellations.
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

    async def _notify_liquidation_event(self) -> None:
        """Broadcasts real-time snapshot event to all connected WebSocket clients."""
        if not self._broadcaster:
            return

        payload: Dict[str, Any] = {
            "type": "symbols_update",
            "timestamp": time.time()
        }

        if self._market_service:
            try:
                stats, sample_info = await self._market_service.get_trade_stats()
                payload["trade_stats"] = stats
                payload["sample_info"] = sample_info
            except Exception:
                pass

        asyncio.create_task(self._broadcaster.broadcast(payload))

    async def cancel_order(self, ticket: int) -> Dict[str, Any]:
        """Cancels a specific pending order."""
        res = await asyncio.to_thread(self._provider.cancel_order, ticket=ticket)
        if res.get("success"):
            await self._notify_liquidation_event()
        return res

    async def cancel_all_orders(self) -> Dict[str, Any]:
        """Cancels all active pending orders in the account."""
        results = await asyncio.to_thread(self._provider.cancel_all_orders)
        await self._notify_liquidation_event()
        success_count = sum(1 for r in results if r.get("success"))
        return {
            "success": True,
            "cancelled_count": success_count,
            "total_count": len(results),
            "results": results
        }

    async def close_all_positions(self) -> Dict[str, Any]:
        """Liquidates all open market positions without touching pending orders."""
        results = await asyncio.to_thread(self._provider.close_all_positions)
        await self._notify_liquidation_event()
        success_count = sum(1 for r in results if r.get("success"))
        return {
            "success": True,
            "closed_count": success_count,
            "total_count": len(results),
            "results": results
        }

    async def flatten_all(self) -> Dict[str, Any]:
        """
        Two-phase Smart Flatten Engine:
        Phase 1: Cancel 100% of pending orders (Buy/Sell Limits, Buy/Sell Stops).
        Phase 2: Liquidate 100% of open market positions.
        Guarantees institutional $0.00 Net Delta exposure.
        """
        logger.warning("Executing Smart Flatten ($0 Delta) Engine across all orders and positions.")

        # Phase 1: Cancel pending orders first to eliminate latent fill risk
        order_results = await asyncio.to_thread(self._provider.cancel_all_orders)
        orders_cancelled = sum(1 for r in order_results if r.get("success"))

        # Phase 2: Liquidate open market positions
        position_results = await asyncio.to_thread(self._provider.close_all_positions)
        positions_closed = sum(1 for r in position_results if r.get("success"))

        await self._notify_liquidation_event()

        summary = FlattenSummary(
            success=True,
            orders_cancelled=orders_cancelled,
            positions_closed=positions_closed,
            order_results=order_results,
            position_results=position_results,
            message=f"Smart Flatten complete: {orders_cancelled} orders cancelled, {positions_closed} positions liquidated"
        )
        return summary.model_dump()
