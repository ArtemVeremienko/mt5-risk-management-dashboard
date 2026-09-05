"""
Market Data Application Service.
Orchestrates market quotes, volatility caching, trade statistics,
and dynamic lot sizing risk matrix calculations.
"""

import asyncio
from typing import Dict, List, Optional, Any, Tuple, Union
from pydantic import BaseModel, Field

from domain.models.account import AccountState
from domain.models.symbol import SymbolSpec
from domain.models.position import Position
from domain.models.trade_stats import TradeStats
from domain.math.margin_engine import calculate_broker_margin
from domain.math.risk_models import (
    calculate_trade_statistics,
    calculate_lot_for_symbol,
)
from infrastructure.providers.base import IMarketDataProvider


class CalculationRequest(BaseModel):
    """
    Request parameters for bulk dynamic risk matrix calculation.
    """
    working_capital: float = Field(default=100.0, description="Virtual / Real Working Capital for risk budgeting")
    deposited_cash: float = Field(default=20.0, description="Broker account deposited equity for margin checks")
    leverage: float = Field(default=300.0, description="Broker account leverage (e.g. 300 for 1:300)")
    risk_method: str = Field(default="fractional", description="Risk model: fractional, kelly_half")
    custom_risk_pct: float = Field(default=1.0, description="Fractional risk percentage (e.g. 1.0 = 1.0%)")
    min_risk_floor_pct: float = Field(default=0.25, description="Quantitative risk floor (%)")
    max_risk_ceiling_pct: float = Field(default=2.50, description="Quantitative risk ceiling (%)")
    global_sl_mode: str = Field(default="1/4 ADR", description="Global SL preset: 1/4 ADR, 1/3 ADR, 1/2 ADR, 1.0 ADR, ATR(14), 20 pips, 50 pips, custom")
    global_sl_pips: float = Field(default=20.0, description="Custom global SL pips when mode is custom")
    symbol_sl_overrides: Dict[str, float] = Field(default_factory=dict, description="Per-symbol SL pips overrides")
    symbols: Optional[List[str]] = Field(default=None, description="Optional subset of symbols to calculate")


class ManualStatsRequest(BaseModel):
    """
    Request parameters for overriding strategy statistics manually.
    """
    win_rate: float = Field(default=0.55, ge=0.01, le=1.0)
    payoff_ratio: float = Field(default=1.5, gt=0.0)
    total_trades: int = Field(default=150, ge=1)


def compute_effective_sl_pips(
    spec: SymbolSpec,
    global_mode: str,
    global_pips: float,
    overrides: Dict[str, float]
) -> float:
    """Resolves dynamic SL in pips from mode, ADR, ATR, or overrides."""
    symbol = spec.symbol
    adr = spec.adr_14_pips or 60.0
    atr = spec.atr_14_pips or 65.0

    if symbol in overrides and overrides[symbol] > 0:
        return float(overrides[symbol])

    if global_mode == "1/4 ADR":
        return max(5.0, round(adr * 0.25, 1))
    elif global_mode == "1/3 ADR":
        return max(5.0, round(adr * (1.0 / 3.0), 1))
    elif global_mode == "1/2 ADR":
        return max(5.0, round(adr * 0.5, 1))
    elif global_mode in ("1 ADR", "1.0 ADR"):
        return max(10.0, round(adr * 1.0, 1))
    elif global_mode in ("1 ATR", "1.0 ATR", "ATR(14)"):
        return max(10.0, round(atr * 1.0, 1))
    elif global_mode == "20 pips":
        return 20.0
    elif global_mode == "50 pips":
        return 50.0
    else:
        return max(1.0, float(global_pips))


class MarketService:
    """
    Application Service orchestrating market data and quantitative sizing.
    """

    def __init__(self, provider: IMarketDataProvider):
        self._provider = provider

    @property
    def provider(self) -> IMarketDataProvider:
        return self._provider

    async def get_account_summary(self) -> AccountState:
        return await asyncio.to_thread(self._provider.get_account_summary)

    async def get_market_symbols(self) -> List[SymbolSpec]:
        return await asyncio.to_thread(self._provider.get_market_symbols)

    async def get_symbol_specs(self, symbol: str) -> Optional[SymbolSpec]:
        return await asyncio.to_thread(self._provider.get_symbol_specs, symbol)

    async def get_open_positions(self) -> List[Position]:
        return await asyncio.to_thread(self._provider.get_open_positions)

    async def refresh_volatility_cache(self) -> None:
        await asyncio.to_thread(self._provider.refresh_volatility_cache)

    async def get_trade_stats(self) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        trades_pnl = await asyncio.to_thread(self._provider.fetch_closed_deals_history)
        trade_records = self._provider.get_cached_trade_records()
        stats = calculate_trade_statistics(trades_pnl, trades_records=trade_records)
        stats_dict = stats.model_dump()
        return stats_dict, stats_dict.get("sample_info", {})

    async def set_custom_trades(self, pnl_list: List[float]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        self._provider.set_custom_trades(pnl_list)
        stats = calculate_trade_statistics(pnl_list)
        stats_dict = stats.model_dump()
        return stats_dict, stats_dict.get("sample_info", {})

    async def set_manual_stats(self, req: ManualStatsRequest) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        stats = calculate_trade_statistics(
            override_win_rate=req.win_rate,
            override_payoff_ratio=req.payoff_ratio,
            override_total_trades=req.total_trades
        )
        stats_dict = stats.model_dump()
        return stats_dict, stats_dict.get("sample_info", {})

    async def calculate_risk_matrix(self, req: CalculationRequest) -> Dict[str, Any]:
        """
        Computes lot sizing for all symbols under the requested risk model,
        working capital, leverage, and dynamic SL settings.
        Pure in-memory execution.
        """
        trades_pnl = await asyncio.to_thread(self._provider.fetch_closed_deals_history)
        trade_records = self._provider.get_cached_trade_records()
        trade_stats = calculate_trade_statistics(trades_pnl, trades_records=trade_records)
        symbols_specs: List[SymbolSpec] = await asyncio.to_thread(self._provider.get_market_symbols)
        account: AccountState = await asyncio.to_thread(self._provider.get_account_summary)
        acc_leverage = float(account.leverage)

        if req.symbols:
            requested_set = {s.upper() for s in req.symbols}
            symbols_specs = [
                s for s in symbols_specs
                if s.symbol.upper() in requested_set
            ]

        results = []
        min_clamped_count = 0
        margin_exceeded_count = 0

        for spec in symbols_specs:
            sym = spec.symbol
            ask = float(spec.ask)
            bid = float(spec.bid)
            ref_price = ask or bid or 1.0
            cat = spec.category
            cs = float(spec.trade_contract_size)
            mpl = spec.margin_per_lot
            pip_val = float(spec.pip_value_per_lot)
            vmin = float(spec.volume_min)
            vmax = float(spec.volume_max)
            vstep = float(spec.volume_step)
            c_base = spec.currency_base or "USD"
            c_profit = spec.currency_profit or "USD"
            c_margin = spec.currency_margin or "USD"
            spec_dict = spec.model_dump()

            sl_pips = compute_effective_sl_pips(spec, req.global_sl_mode, req.global_sl_pips, req.symbol_sl_overrides)

            def resolve_margin(exec_lot: float) -> float:
                return calculate_broker_margin(
                    symbol=sym,
                    lots=exec_lot,
                    price=ask,
                    acc_leverage=acc_leverage,
                    user_leverage=req.leverage,
                    margin_per_lot=mpl,
                    ref_price=ref_price,
                    category=cat,
                    contract_size=cs
                )

            pre_calc = calculate_lot_for_symbol(
                symbol=sym, working_capital=req.working_capital, deposited_cash=req.deposited_cash, leverage=req.leverage,
                sl_pips=sl_pips, pip_value_per_lot=pip_val, market_price=ask,
                contract_size=cs, volume_min=vmin, volume_max=vmax,
                volume_step=vstep, risk_method=req.risk_method, custom_risk_pct=req.custom_risk_pct,
                trade_stats=trade_stats, currency_base=c_base,
                currency_profit=c_profit, currency_margin=c_margin
            )

            broker_margin = resolve_margin(pre_calc.executable_lot)

            calc = calculate_lot_for_symbol(
                symbol=sym,
                working_capital=req.working_capital,
                deposited_cash=req.deposited_cash,
                leverage=req.leverage,
                sl_pips=sl_pips,
                pip_value_per_lot=pip_val,
                market_price=ask,
                contract_size=cs,
                volume_min=vmin,
                volume_max=vmax,
                volume_step=vstep,
                risk_method=req.risk_method,
                custom_risk_pct=req.custom_risk_pct,
                trade_stats=trade_stats,
                currency_base=c_base,
                currency_profit=c_profit,
                currency_margin=c_margin,
                exact_broker_margin=broker_margin,
                min_risk_floor_pct=req.min_risk_floor_pct,
                max_risk_ceiling_pct=req.max_risk_ceiling_pct
            )

            if calc.is_clamped_to_min:
                min_clamped_count += 1
            if calc.is_margin_exceeded:
                margin_exceeded_count += 1

            # Comparison models
            alt_frac_pre = calculate_lot_for_symbol(
                symbol=sym, working_capital=req.working_capital, deposited_cash=req.deposited_cash, leverage=req.leverage,
                sl_pips=sl_pips, pip_value_per_lot=pip_val, market_price=ask,
                contract_size=cs, volume_min=vmin, volume_max=vmax,
                volume_step=vstep, risk_method="fractional", custom_risk_pct=1.0, trade_stats=trade_stats,
                currency_base=c_base, currency_profit=c_profit,
                currency_margin=c_margin
            )
            margin_frac = resolve_margin(alt_frac_pre.executable_lot)
            alt_fractional = calculate_lot_for_symbol(
                symbol=sym, working_capital=req.working_capital, deposited_cash=req.deposited_cash, leverage=req.leverage,
                sl_pips=sl_pips, pip_value_per_lot=pip_val, market_price=ask,
                contract_size=cs, volume_min=vmin, volume_max=vmax,
                volume_step=vstep, risk_method="fractional", custom_risk_pct=1.0, trade_stats=trade_stats,
                currency_base=c_base, currency_profit=c_profit,
                currency_margin=c_margin, exact_broker_margin=margin_frac
            )

            alt_hk_pre = calculate_lot_for_symbol(
                symbol=sym, working_capital=req.working_capital, deposited_cash=req.deposited_cash, leverage=req.leverage,
                sl_pips=sl_pips, pip_value_per_lot=pip_val, market_price=ask,
                contract_size=cs, volume_min=vmin, volume_max=vmax,
                volume_step=vstep, risk_method="kelly_half", custom_risk_pct=1.0, trade_stats=trade_stats,
                currency_base=c_base, currency_profit=c_profit,
                currency_margin=c_margin, min_risk_floor_pct=req.min_risk_floor_pct,
                max_risk_ceiling_pct=req.max_risk_ceiling_pct
            )
            margin_hk = resolve_margin(alt_hk_pre.executable_lot)
            alt_half_kelly = calculate_lot_for_symbol(
                symbol=sym, working_capital=req.working_capital, deposited_cash=req.deposited_cash, leverage=req.leverage,
                sl_pips=sl_pips, pip_value_per_lot=pip_val, market_price=ask,
                contract_size=cs, volume_min=vmin, volume_max=vmax,
                volume_step=vstep, risk_method="kelly_half", custom_risk_pct=1.0, trade_stats=trade_stats,
                currency_base=c_base, currency_profit=c_profit,
                currency_margin=c_margin, exact_broker_margin=margin_hk,
                min_risk_floor_pct=req.min_risk_floor_pct, max_risk_ceiling_pct=req.max_risk_ceiling_pct
            )

            results.append({
                "spec": spec_dict,
                "calc": calc.model_dump(),
                "comparison": {
                    "fractional_1pct": {"lot": alt_fractional.executable_lot, "risk_pct": alt_fractional.effective_risk_pct, "margin": alt_fractional.required_margin},
                    "half_kelly": {"lot": alt_half_kelly.executable_lot, "risk_pct": alt_half_kelly.effective_risk_pct, "margin": alt_half_kelly.required_margin}
                }
            })

        return {
            "trade_stats": trade_stats.model_dump(),
            "results": results,
            "summary": {
                "total_symbols": len(results),
                "min_clamped_count": min_clamped_count,
                "margin_exceeded_count": margin_exceeded_count,
                "working_capital": req.working_capital,
                "deposited_cash": req.deposited_cash,
                "leverage": req.leverage,
                "risk_method": req.risk_method
            }
        }
