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
    client_order_id: Optional[str] = Field(default=None, description="Optional unique client order ID for idempotency")
    bypass_spread_guard: bool = Field(default=False, description="Explicit flag to bypass spread blowout guard")


class PositionCloseRequest(BaseModel):
    """Request payload for closing an open position."""
    ticket: int
    volume: Optional[float] = Field(default=None, description="Optional volume to close (for partial liquidation)")


class PositionModifyRequest(BaseModel):
    """Request payload for modifying Stop Loss and Take Profit."""
    ticket: int
    sl: Optional[float] = Field(default=None, description="New absolute Stop Loss price")
    tp: Optional[float] = Field(default=None, description="New absolute Take Profit price")


from domain.safety.gatekeeper import PreTradeGatekeeper
from domain.math.margin_engine import calculate_broker_margin


class ExecutionService:
    """
    Application Service for trade execution and liquidation operations.
    Enforces institutional pre-trade risk gatekeeper checks:
    - 300ms order debouncing & idempotency key caching
    - Spread blowout guard (>2.5x median spread)
    - Margin health check (required margin <= 95% free margin)
    - Broker volume step limits
    """

    def __init__(
        self,
        execution_provider: IExecutionProvider,
        broadcaster: Optional[BroadcastHub] = None,
        market_service: Optional[MarketService] = None,
        spread_multiplier_limit: float = 2.5,
        max_margin_usage_ratio: float = 0.95,
        debounce_window_seconds: float = 0.30
    ):
        self._provider = execution_provider
        self._broadcaster = broadcaster
        self._market_service = market_service
        self._spread_multiplier_limit = spread_multiplier_limit
        self._max_margin_usage_ratio = max_margin_usage_ratio
        self._debounce_window = debounce_window_seconds
        # In-memory recent order dispatch cache: key -> timestamp
        self._recent_orders: Dict[str, float] = {}
        # Completed idempotent order responses: client_order_id -> Dict[str, Any]
        self._idempotency_cache: Dict[str, Dict[str, Any]] = {}

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
        now = time.time()

        # 1. Idempotency Check (by client_order_id)
        if req.client_order_id and req.client_order_id in self._idempotency_cache:
            return self._idempotency_cache[req.client_order_id]

        # 2. Debounce Check (300ms window by signature: symbol_action_volume)
        sig = f"{req.symbol.upper()}_{req.action.upper()}_{round(req.volume, 4)}"
        last_time = self._recent_orders.get(sig, 0.0)
        if (now - last_time) < self._debounce_window:
            return {
                "success": False,
                "error": f"Duplicate order debounced ({int(self._debounce_window * 1000)}ms window)",
                "code": "ORDER_DEBOUNCED"
            }

        # 3. Pre-Trade Gatekeeper Validations (if market_service available)
        if self._market_service:
            try:
                spec = await self._market_service.get_symbol_specs(req.symbol)
                account = await self._market_service.get_account_summary()

                if spec:
                    # 3.1 Volume constraints
                    vol_ok, vol_err = PreTradeGatekeeper.validate_volume_limits(
                        volume=req.volume,
                        volume_min=spec.volume_min,
                        volume_max=spec.volume_max,
                        volume_step=spec.volume_step
                    )
                    if not vol_ok:
                        return {"success": False, "error": vol_err, "code": "INVALID_VOLUME"}

                    # 3.2 Spread Blowout Guard
                    if not req.bypass_spread_guard and spec.median_spread_pips and spec.median_spread_pips > 0:
                        spread_ok, spread_err = PreTradeGatekeeper.validate_spread(
                            current_spread_pips=spec.spread_pips,
                            median_spread_pips=spec.median_spread_pips,
                            max_multiplier=self._spread_multiplier_limit
                        )
                        if not spread_ok:
                            return {"success": False, "error": spread_err, "code": "SPREAD_BLOWOUT"}

                    # 3.3 Margin Health Check
                    price = spec.ask if req.action.upper() == "BUY" else spec.bid
                    required_margin = calculate_broker_margin(
                        symbol=spec.symbol,
                        lots=req.volume,
                        price=price,
                        acc_leverage=account.leverage,
                        margin_per_lot=spec.margin_per_lot,
                        category=spec.category,
                        contract_size=spec.trade_contract_size
                    )
                    margin_ok, margin_err = PreTradeGatekeeper.validate_margin_health(
                        required_margin=required_margin,
                        free_margin=account.free_margin,
                        max_margin_usage_ratio=self._max_margin_usage_ratio
                    )
                    if not margin_ok:
                        return {"success": False, "error": margin_err, "code": "INSUFFICIENT_MARGIN"}
            except Exception as e:
                # Log and allow broker execution if telemetry lookup fails
                pass

        # Record signature timestamp to enforce debounce
        self._recent_orders[sig] = now
        # Clean up debounce cache older than 10 seconds
        cutoff = now - 10.0
        self._recent_orders = {k: v for k, v in self._recent_orders.items() if v > cutoff}

        # 4. Dispatch order to execution provider
        res = await asyncio.to_thread(
            self._provider.send_market_order,
            symbol=req.symbol,
            action=req.action,
            volume=req.volume,
            sl_pips=req.sl_pips,
            rr_ratio=req.rr_ratio,
            comment=req.comment
        )

        if req.client_order_id:
            self._idempotency_cache[req.client_order_id] = res
            # Keep idempotency cache bounded
            if len(self._idempotency_cache) > 200:
                self._idempotency_cache.pop(next(iter(self._idempotency_cache)))

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
