from typing import Dict, Any, List
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from application.execution_service import ExecutionService, OrderExecuteRequest
from application.liquidation_service import LiquidationService
from presentation.dependencies import get_execution_service, get_liquidation_service

router = APIRouter(prefix="/api/order", tags=["Order Execution"])


class OrderCancelRequest(BaseModel):
    ticket: int = Field(..., description="Pending order ticket to cancel")


@router.post("/execute")
async def execute_order(
    req: OrderExecuteRequest,
    execution_service: ExecutionService = Depends(get_execution_service)
) -> Dict[str, Any]:
    """Executes a market BUY or SELL order directly into MT5 with exact lot sizing and SL/TP prices."""
    return await execution_service.send_market_order(req)


@router.post("/cancel")
async def cancel_order(
    req: OrderCancelRequest,
    liquidation_service: LiquidationService = Depends(get_liquidation_service)
) -> Dict[str, Any]:
    """Cancels a specific pending limit or stop order."""
    return await liquidation_service.cancel_order(ticket=req.ticket)


@router.post("/cancel-all")
async def cancel_all_orders(
    liquidation_service: LiquidationService = Depends(get_liquidation_service)
) -> Dict[str, Any]:
    """Cancels all active pending orders in the account."""
    return await liquidation_service.cancel_all_orders()
