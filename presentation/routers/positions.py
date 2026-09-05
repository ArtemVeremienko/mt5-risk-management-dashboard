"""
Position management and bulk liquidation router.
"""

from typing import Dict, Any, List
from fastapi import APIRouter, Depends
from domain.models.position import Position
from application.market_service import MarketService
from application.execution_service import (
    ExecutionService,
    PositionCloseRequest,
    PositionModifyRequest,
)
from presentation.dependencies import get_market_service, get_execution_service

router = APIRouter(tags=["Positions"])


@router.get("/api/positions")
async def get_positions(market_service: MarketService = Depends(get_market_service)) -> Dict[str, Any]:
    """Retrieves all currently open positions with floating P&L and R-multiples."""
    positions = await market_service.get_open_positions()
    return {
        "positions": [p.model_dump() for p in positions],
        "count": len(positions)
    }


@router.post("/api/position/close")
async def close_position(
    req: PositionCloseRequest,
    execution_service: ExecutionService = Depends(get_execution_service)
) -> Dict[str, Any]:
    """Closes an open position (full or partial volume)."""
    return await execution_service.close_position(req)


@router.post("/api/position/modify")
async def modify_position(
    req: PositionModifyRequest,
    execution_service: ExecutionService = Depends(get_execution_service)
) -> Dict[str, Any]:
    """Modifies SL/TP price levels on an open position."""
    return await execution_service.modify_position_sltp(req)


@router.post("/api/position/close-all")
async def close_all_positions(
    execution_service: ExecutionService = Depends(get_execution_service)
) -> Dict[str, Any]:
    """Closes all open positions in MT5."""
    return await execution_service.close_all_positions()


@router.post("/api/position/break-even-all")
async def break_even_all_positions(
    execution_service: ExecutionService = Depends(get_execution_service)
) -> Dict[str, Any]:
    """Snaps SL to Universal Cost-Absorbing BE for all eligible open positions."""
    return await execution_service.break_even_all_positions()


@router.post("/api/position/close-50-all")
async def close_50_all_positions(
    execution_service: ExecutionService = Depends(get_execution_service)
) -> Dict[str, Any]:
    """Closes 50% volume and locks BE on remaining volume across all eligible open positions."""
    return await execution_service.close_50_all_positions()
