"""
Market Symbols and Risk Calculation router.
"""

from typing import List, Dict, Any
from fastapi import APIRouter, Depends
from domain.models.symbol import SymbolSpec
from application.market_service import MarketService, CalculationRequest
from presentation.dependencies import get_market_service

router = APIRouter(tags=["Symbols & Calculation"])


@router.get("/api/symbols", response_model=List[SymbolSpec])
async def get_symbols(market_service: MarketService = Depends(get_market_service)) -> List[SymbolSpec]:
    """Returns all available Market Watch symbols with specifications and 14D ADR."""
    return await market_service.get_market_symbols()


@router.post("/api/calculate")
async def calculate_risk_matrix(
    req: CalculationRequest,
    market_service: MarketService = Depends(get_market_service)
) -> Dict[str, Any]:
    """
    Computes dynamic lot sizing for all symbols under requested risk model,
    working capital, leverage, and SL settings.
    """
    return await market_service.calculate_risk_matrix(req)
