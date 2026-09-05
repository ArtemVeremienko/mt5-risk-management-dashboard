"""
Account telemetry router.
Provides endpoint for live/simulated MT5 account state.
"""

from typing import Dict, Any
from fastapi import APIRouter, Depends
from domain.models.account import AccountState
from application.market_service import MarketService
from presentation.dependencies import get_market_service

router = APIRouter(prefix="/api/account", tags=["Account"])


@router.get("", response_model=AccountState)
async def get_account(market_service: MarketService = Depends(get_market_service)) -> AccountState:
    """Returns live or simulated MT5 account balance, equity, leverage, and free margin."""
    return await market_service.get_account_summary()
