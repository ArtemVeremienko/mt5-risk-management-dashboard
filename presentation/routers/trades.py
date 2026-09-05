"""
Trade statistics and closed deals history router.
"""

import io
import csv
from typing import Dict, Any
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException

from application.market_service import MarketService, ManualStatsRequest
from presentation.dependencies import get_market_service

router = APIRouter(tags=["Trades & Statistics"])


@router.get("/api/trade-history")
async def get_trade_history(market_service: MarketService = Depends(get_market_service)) -> Dict[str, Any]:
    """Returns trade statistics, Kelly metrics, and sample size tier."""
    stats, sample_info = await market_service.get_trade_stats()
    cached = market_service.provider.get_cached_trades()
    return {
        "stats": stats,
        "sample_info": sample_info,
        "recent_trades": cached[-50:] if cached else []
    }


@router.post("/api/upload-trades")
async def upload_trades_csv(
    file: UploadFile = File(...),
    market_service: MarketService = Depends(get_market_service)
) -> Dict[str, Any]:
    """Uploads a CSV file containing closed trade profits to recalculate Kelly metrics."""
    content = await file.read()
    text = content.decode("utf-8", errors="ignore")
    reader = csv.reader(io.StringIO(text))

    pnl_list = []
    for row in reader:
        if not row:
            continue
        for cell in row:
            try:
                cleaned = cell.replace("$", "").replace(",", "").strip()
                val = float(cleaned)
                pnl_list.append(val)
                break
            except ValueError:
                continue

    if len(pnl_list) < 5:
        raise HTTPException(status_code=400, detail="CSV must contain at least 5 numeric trade PnL entries.")

    stats, sample_info = await market_service.set_custom_trades(pnl_list)
    return {
        "status": "success",
        "message": f"Successfully parsed {len(pnl_list)} trades from CSV.",
        "stats": stats,
        "sample_info": sample_info
    }


@router.post("/api/manual-stats")
async def set_manual_stats(
    req: ManualStatsRequest,
    market_service: MarketService = Depends(get_market_service)
) -> Dict[str, Any]:
    """Sets manual strategy performance parameters (Win Rate, Payoff, Total Trades)."""
    stats, sample_info = await market_service.set_manual_stats(req)
    return {
        "status": "success",
        "stats": stats,
        "sample_info": sample_info
    }
