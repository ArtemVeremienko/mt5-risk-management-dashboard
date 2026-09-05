"""
Order execution router.
"""

from typing import Dict, Any
from fastapi import APIRouter, Depends
from application.execution_service import ExecutionService, OrderExecuteRequest
from presentation.dependencies import get_execution_service

router = APIRouter(prefix="/api/order", tags=["Order Execution"])


@router.post("/execute")
async def execute_order(
    req: OrderExecuteRequest,
    execution_service: ExecutionService = Depends(get_execution_service)
) -> Dict[str, Any]:
    """Executes a market BUY or SELL order directly into MT5 with exact lot sizing and SL/TP prices."""
    return await execution_service.send_market_order(req)
