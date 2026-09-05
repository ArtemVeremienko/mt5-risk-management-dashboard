"""
Standalone Mock / Fallback Data and Execution Provider.
Provides deterministic synthetic data for development, testing, and offline usage.
"""

import time
import numpy as np
from typing import Dict, List, Optional, Any

from domain.models.account import AccountState
from domain.models.symbol import SymbolSpec, StepRule
from domain.models.position import Position
from domain.models.trade_stats import TradeRecord
from infrastructure.providers.base import IMarketDataProvider, IExecutionProvider

MOCK_SYMBOLS_SPECS = [
    {
        "symbol": "EURUSD", "category": "Forex Majors", "bid": 1.08500, "ask": 1.08512, "digits": 5, "point": 0.00001,
        "pip_size": 0.0001, "trade_contract_size": 100000.0, "trade_tick_value": 1.0, "trade_tick_size": 0.00001,
        "volume_min": 0.01, "volume_max": 100.0, "volume_step": 0.01, "adr_14_pips": 68.4, "atr_14_pips": 72.1
    },
    {
        "symbol": "GBPUSD", "category": "Forex Majors", "bid": 1.29400, "ask": 1.29415, "digits": 5, "point": 0.00001,
        "pip_size": 0.0001, "trade_contract_size": 100000.0, "trade_tick_value": 1.0, "trade_tick_size": 0.00001,
        "volume_min": 0.01, "volume_max": 100.0, "volume_step": 0.01, "adr_14_pips": 94.2, "atr_14_pips": 98.0
    },
    {
        "symbol": "USDJPY", "category": "Forex Majors", "bid": 154.250, "ask": 154.265, "digits": 3, "point": 0.001,
        "pip_size": 0.01, "trade_contract_size": 100000.0, "trade_tick_value": 0.648, "trade_tick_size": 0.001,
        "volume_min": 0.01, "volume_max": 100.0, "volume_step": 0.01, "adr_14_pips": 112.5, "atr_14_pips": 118.0
    },
    {
        "symbol": "AUDUSD", "category": "Forex Majors", "bid": 0.65350, "ask": 0.65362, "digits": 5, "point": 0.00001,
        "pip_size": 0.0001, "trade_contract_size": 100000.0, "trade_tick_value": 1.0, "trade_tick_size": 0.00001,
        "volume_min": 0.01, "volume_max": 100.0, "volume_step": 0.01, "adr_14_pips": 58.0, "atr_14_pips": 61.3
    },
    {
        "symbol": "USDCAD", "category": "Forex Majors", "bid": 1.38120, "ask": 1.38135, "digits": 5, "point": 0.00001,
        "pip_size": 0.0001, "trade_contract_size": 100000.0, "trade_tick_value": 0.724, "trade_tick_size": 0.00001,
        "volume_min": 0.01, "volume_max": 100.0, "volume_step": 0.01, "adr_14_pips": 62.1, "atr_14_pips": 65.4
    },
    {
        "symbol": "USDCHF", "category": "Forex Majors", "bid": 0.88450, "ask": 0.88465, "digits": 5, "point": 0.00001,
        "pip_size": 0.0001, "trade_contract_size": 100000.0, "trade_tick_value": 1.13, "trade_tick_size": 0.00001,
        "volume_min": 0.01, "volume_max": 100.0, "volume_step": 0.01, "adr_14_pips": 52.8, "atr_14_pips": 55.0
    },
    {
        "symbol": "NZDUSD", "category": "Forex Majors", "bid": 0.59200, "ask": 0.59215, "digits": 5, "point": 0.00001,
        "pip_size": 0.0001, "trade_contract_size": 100000.0, "trade_tick_value": 1.0, "trade_tick_size": 0.00001,
        "volume_min": 0.01, "volume_max": 100.0, "volume_step": 0.01, "adr_14_pips": 51.5, "atr_14_pips": 54.2
    },
    {
        "symbol": "EURGBP", "category": "Forex Minors", "bid": 0.83850, "ask": 0.83864, "digits": 5, "point": 0.00001,
        "pip_size": 0.0001, "trade_contract_size": 100000.0, "trade_tick_value": 1.294, "trade_tick_size": 0.00001,
        "volume_min": 0.01, "volume_max": 100.0, "volume_step": 0.01, "adr_14_pips": 38.6, "atr_14_pips": 41.0
    },
    {
        "symbol": "EURJPY", "category": "Forex Minors", "bid": 167.350, "ask": 167.368, "digits": 3, "point": 0.001,
        "pip_size": 0.01, "trade_contract_size": 100000.0, "trade_tick_value": 0.648, "trade_tick_size": 0.001,
        "volume_min": 0.01, "volume_max": 100.0, "volume_step": 0.01, "adr_14_pips": 128.4, "atr_14_pips": 134.0
    },
    {
        "symbol": "GBPJPY", "category": "Forex Minors", "bid": 199.600, "ask": 199.622, "digits": 3, "point": 0.001,
        "pip_size": 0.01, "trade_contract_size": 100000.0, "trade_tick_value": 0.648, "trade_tick_size": 0.001,
        "volume_min": 0.01, "volume_max": 100.0, "volume_step": 0.01, "adr_14_pips": 156.0, "atr_14_pips": 162.5
    },
    {
        "symbol": "XAUUSD", "category": "Metals", "bid": 2650.50, "ask": 2650.85, "digits": 2, "point": 0.01,
        "pip_size": 0.1, "trade_contract_size": 100.0, "trade_tick_value": 1.0, "trade_tick_size": 0.01,
        "volume_min": 0.01, "volume_max": 50.0, "volume_step": 0.01, "adr_14_pips": 310.0, "atr_14_pips": 325.0
    },
    {
        "symbol": "XAGUSD", "category": "Metals", "bid": 31.450, "ask": 31.475, "digits": 3, "point": 0.001,
        "pip_size": 0.01, "trade_contract_size": 5000.0, "trade_tick_value": 5.0, "trade_tick_size": 0.001,
        "volume_min": 0.01, "volume_max": 20.0, "volume_step": 0.01, "adr_14_pips": 85.0, "atr_14_pips": 90.0
    },
    {
        "symbol": "USOIL", "category": "Energies", "bid": 71.25, "ask": 71.29, "digits": 2, "point": 0.01,
        "pip_size": 0.01, "trade_contract_size": 1000.0, "trade_tick_value": 10.0, "trade_tick_size": 0.01,
        "volume_min": 0.01, "volume_max": 50.0, "volume_step": 0.01, "adr_14_pips": 180.0, "atr_14_pips": 192.0
    },
    {
        "symbol": "US500", "category": "Indices", "bid": 5820.5, "ask": 5821.1, "digits": 1, "point": 0.1,
        "pip_size": 1.0, "trade_contract_size": 10.0, "trade_tick_value": 1.0, "trade_tick_size": 0.1,
        "volume_min": 0.1, "volume_max": 100.0, "volume_step": 0.1, "adr_14_pips": 54.0, "atr_14_pips": 58.0
    },
    {
        "symbol": "USTECH", "category": "Indices", "bid": 20450.0, "ask": 20452.5, "digits": 1, "point": 0.1,
        "pip_size": 1.0, "trade_contract_size": 10.0, "trade_tick_value": 1.0, "trade_tick_size": 0.1,
        "volume_min": 0.1, "volume_max": 100.0, "volume_step": 0.1, "adr_14_pips": 240.0, "atr_14_pips": 255.0
    },
    {
        "symbol": "BTCUSD", "category": "Crypto", "bid": 92450.0, "ask": 92485.0, "digits": 2, "point": 0.01,
        "pip_size": 1.0, "trade_contract_size": 1.0, "trade_tick_value": 0.01, "trade_tick_size": 0.01,
        "volume_min": 0.01, "volume_max": 10.0, "volume_step": 0.01, "adr_14_pips": 3200.0, "atr_14_pips": 3450.0
    }
]


def generate_mock_trades_pnl(count: int = 185, win_rate: float = 0.56, payoff_ratio: float = 1.45) -> List[float]:
    """Generates synthetic closed trade PnLs for demo/fallback purposes."""
    np.random.seed(42)
    trades = []
    avg_win = 45.0
    avg_loss = avg_win / payoff_ratio

    for _ in range(count):
        is_win = bool(np.random.rand() < win_rate)
        if is_win:
            val = float(np.random.exponential(scale=avg_win))
            trades.append(round(val, 2))
        else:
            val = -float(np.random.exponential(scale=avg_loss))
            trades.append(round(val, 2))
    return trades


class MockDataProvider(IMarketDataProvider, IExecutionProvider):
    """
    In-memory Mock Provider for offline execution, unit testing, and demonstration.
    """

    def __init__(self, initial_balance: float = 100.0, initial_leverage: float = 300.0):
        self._balance = initial_balance
        self._equity = initial_balance
        self._leverage = initial_leverage
        self._custom_trades: Optional[List[float]] = None
        self._cached_trades: List[float] = generate_mock_trades_pnl()
        self._positions: Dict[int, Position] = {}
        self._pending_orders: Dict[int, Dict[str, Any]] = {}
        self._next_ticket = 100001

    @property
    def is_connected(self) -> bool:
        return True

    @property
    def is_live(self) -> bool:
        return False

    def get_account_summary(self) -> AccountState:
        total_margin = sum(pos.volume * 50.0 for pos in self._positions.values())
        floating_profit = sum(pos.profit for pos in self._positions.values())
        equity = self._balance + floating_profit
        free_margin = max(0.0, equity - total_margin)
        margin_level = (equity / total_margin * 100.0) if total_margin > 0 else 0.0

        return AccountState(
            balance=self._balance,
            equity=round(equity, 2),
            margin=round(total_margin, 2),
            free_margin=round(free_margin, 2),
            margin_level=round(margin_level, 1),
            leverage=self._leverage,
            profit=round(floating_profit, 2),
            currency="USD",
            server="Demo-Mock-Server",
            name="Mock Trader",
            login=99912345,
            account_type="Hedge",
            is_live=False,
            trade_mode="Demo",
            is_real=False
        )

    def _compute_step_rule(self, digits: int, point: float, pip_size: float, category: str) -> StepRule:
        cat = category.lower()
        if "crypto" in cat or "indice" in cat:
            normal_step = 10.0 * pip_size
            fast_step = 50.0 * pip_size
            precision_step = 1.0 * pip_size
        elif "metal" in cat or "energie" in cat:
            normal_step = 5.0 * pip_size
            fast_step = 25.0 * pip_size
            precision_step = 1.0 * pip_size
        else:
            normal_step = 1.0 * pip_size
            fast_step = 5.0 * pip_size
            precision_step = 0.1 * pip_size

        return StepRule(
            pip_size=pip_size,
            digits=digits,
            normal_step=normal_step,
            fast_step=fast_step,
            precision_step=precision_step,
            unit_label="pips",
            stops_level_pips=0.0
        )

    def get_market_symbols(self) -> List[SymbolSpec]:
        specs: List[SymbolSpec] = []
        for raw in MOCK_SYMBOLS_SPECS:
            pip_val = (raw["trade_tick_value"] / raw["trade_tick_size"]) * raw["pip_size"]
            spread = round((raw["ask"] - raw["bid"]) / raw["pip_size"], 1)
            adr = raw["adr_14_pips"]
            today_range = round(adr * 0.45, 1)
            adr_used_pct = round((today_range / adr) * 100.0, 1) if adr > 0 else 0.0
            adr_left_pips = max(0.0, round(adr - today_range, 1))
            room_up_pips = round(adr_left_pips * 0.6, 1)
            room_down_pips = round(adr_left_pips * 0.4, 1)

            step_rule = self._compute_step_rule(
                digits=raw["digits"],
                point=raw["point"],
                pip_size=raw["pip_size"],
                category=raw["category"]
            )

            spec = SymbolSpec(
                symbol=raw["symbol"],
                category=raw["category"],
                bid=raw["bid"],
                ask=raw["ask"],
                digits=raw["digits"],
                point=raw["point"],
                pip_size=raw["pip_size"],
                trade_contract_size=raw["trade_contract_size"],
                trade_tick_value=raw["trade_tick_value"],
                trade_tick_size=raw["trade_tick_size"],
                volume_min=raw["volume_min"],
                volume_max=raw["volume_max"],
                volume_step=raw["volume_step"],
                pip_value_per_lot=round(pip_val, 3),
                spread_pips=spread,
                median_spread_pips=spread,
                adr_14_pips=raw["adr_14_pips"],
                atr_14_pips=raw["atr_14_pips"],
                currency_base="USD" if len(raw["symbol"]) > 6 else raw["symbol"][:3],
                currency_profit="USD",
                currency_margin="USD",
                bid_display=f"{raw['bid']:.{raw['digits']}f}",
                ask_display=f"{raw['ask']:.{raw['digits']}f}",
                spread_display=f"{spread:.1f}",
                adr_display=f"{raw['adr_14_pips']:.1f}",
                atr_display=f"{raw['atr_14_pips']:.1f}",
                step_rule=step_rule,
                today_range_pips=today_range,
                adr_used_pct=adr_used_pct,
                adr_left_pips=adr_left_pips,
                room_up_pips=room_up_pips,
                room_down_pips=room_down_pips
            )
            specs.append(spec)
        return specs

    def get_symbol_specs(self, symbol: str) -> Optional[SymbolSpec]:
        sym = symbol.upper()
        for spec in self.get_market_symbols():
            if spec.symbol.upper() == sym:
                return spec
        return None

    def fetch_closed_deals_history(self, days: Optional[int] = None) -> List[float]:
        if self._custom_trades is not None:
            return self._custom_trades
        return self._cached_trades

    def set_custom_trades(self, pnl_list: List[float]) -> None:
        self._custom_trades = list(pnl_list)
        self._cached_trades = list(pnl_list)

    def get_cached_trades(self) -> List[float]:
        return self._cached_trades

    def get_cached_trade_records(self) -> Optional[List[TradeRecord]]:
        return None

    def refresh_volatility_cache(self, symbols: Optional[List[str]] = None, force: bool = False) -> None:
        pass

    def get_open_positions(self) -> List[Position]:
        return list(self._positions.values())

    # --- IExecutionProvider Methods ---

    def send_market_order(
        self,
        symbol: str,
        action: str,
        volume: float,
        sl_pips: float,
        rr_ratio: float = 1.0,
        comment: str = "RiskDashboard"
    ) -> Dict[str, Any]:
        action_upper = action.upper()
        if action_upper not in ("BUY", "SELL"):
            return {"success": False, "error": f"Invalid action: {action}. Must be 'BUY' or 'SELL'."}

        spec = self.get_symbol_specs(symbol)
        if not spec:
            return {"success": False, "error": f"Unknown symbol: {symbol}"}

        ticket = self._next_ticket
        self._next_ticket += 1

        is_buy = action_upper == "BUY"
        entry_price = spec.ask if is_buy else spec.bid
        pip_size = spec.pip_size

        if is_buy:
            sl_price = round(entry_price - (sl_pips * pip_size), spec.digits)
            tp_price = round(entry_price + (sl_pips * rr_ratio * pip_size), spec.digits) if rr_ratio > 0 else 0.0
        else:
            sl_price = round(entry_price + (sl_pips * pip_size), spec.digits)
            tp_price = round(entry_price - (sl_pips * rr_ratio * pip_size), spec.digits) if rr_ratio > 0 else 0.0

        pos = Position(
            ticket=ticket,
            symbol=spec.symbol,
            type=action_upper,
            volume=round(volume, 2),
            price_open=entry_price,
            price_current=entry_price,
            sl=sl_price,
            tp=tp_price,
            initial_sl=sl_price,
            is_sl_in_profit=False,
            locked_r=0.0,
            profit=0.0,
            swap=0.0,
            pnl_pips=0.0,
            r_multiple=0.0,
            comment=comment,
            magic=123456,
            time=int(time.time()),
            digits=spec.digits,
            pip_size=spec.pip_size,
            step_rule=spec.step_rule
        )
        self._positions[ticket] = pos
        return {
            "success": True,
            "ticket": ticket,
            "action": action_upper,
            "price": entry_price,
            "volume": volume,
            "sl": sl_price,
            "tp": tp_price,
            "message": f"Order executed successfully #{ticket}"
        }

    def modify_position_sltp(
        self,
        ticket: int,
        sl: Optional[float] = None,
        tp: Optional[float] = None
    ) -> Dict[str, Any]:
        if ticket not in self._positions:
            return {"success": False, "error": f"Position #{ticket} not found"}

        pos = self._positions[ticket]
        new_sl = pos.sl if sl is None else sl
        new_tp = pos.tp if tp is None else tp

        is_buy = pos.type == "BUY"
        is_sl_in_profit = (new_sl >= pos.price_open) if is_buy else (new_sl <= pos.price_open and new_sl > 0)
        
        updated = Position(
            ticket=pos.ticket,
            symbol=pos.symbol,
            type=pos.type,
            volume=pos.volume,
            price_open=pos.price_open,
            price_current=pos.price_current,
            sl=new_sl,
            tp=new_tp,
            initial_sl=pos.initial_sl,
            is_sl_in_profit=is_sl_in_profit,
            locked_r=pos.locked_r,
            profit=pos.profit,
            swap=pos.swap,
            pnl_pips=pos.pnl_pips,
            r_multiple=pos.r_multiple,
            comment=pos.comment,
            magic=pos.magic,
            time=pos.time,
            digits=pos.digits,
            pip_size=pos.pip_size,
            step_rule=pos.step_rule
        )
        self._positions[ticket] = updated
        return {"success": True, "ticket": ticket, "sl": new_sl, "tp": new_tp}

    def close_position(
        self,
        ticket: int,
        volume: Optional[float] = None
    ) -> Dict[str, Any]:
        if ticket not in self._positions:
            return {"success": False, "error": f"Position #{ticket} not found"}

        pos = self._positions[ticket]
        if volume is not None and volume < pos.volume:
            remaining = round(pos.volume - volume, 2)
            updated = Position(
                ticket=pos.ticket,
                symbol=pos.symbol,
                type=pos.type,
                volume=remaining,
                price_open=pos.price_open,
                price_current=pos.price_current,
                sl=pos.sl,
                tp=pos.tp,
                initial_sl=pos.initial_sl,
                is_sl_in_profit=pos.is_sl_in_profit,
                locked_r=pos.locked_r,
                profit=round(pos.profit * (remaining / pos.volume), 2),
                swap=pos.swap,
                pnl_pips=pos.pnl_pips,
                r_multiple=pos.r_multiple,
                comment=pos.comment,
                magic=pos.magic,
                time=pos.time,
                digits=pos.digits,
                pip_size=pos.pip_size,
                step_rule=pos.step_rule
            )
            self._positions[ticket] = updated
            return {"success": True, "ticket": ticket, "closed_volume": volume, "remaining_volume": remaining}
        else:
            del self._positions[ticket]
            return {"success": True, "ticket": ticket, "closed_volume": pos.volume}

    def close_all_positions(self) -> List[Dict[str, Any]]:
        results = []
        for ticket in list(self._positions.keys()):
            res = self.close_position(ticket)
            results.append(res)
        return results

    def break_even_all_positions(self) -> Dict[str, Any]:
        modified = 0
        for ticket, pos in list(self._positions.items()):
            be_price = pos.price_open
            self.modify_position_sltp(ticket, sl=be_price)
            modified += 1
        return {"success": True, "modified_count": modified}

    def close_50_all_positions(self) -> Dict[str, Any]:
        closed = 0
        for ticket, pos in list(self._positions.items()):
            half = round(pos.volume * 0.5, 2)
            if half >= 0.01:
                self.close_position(ticket, volume=half)
                self.modify_position_sltp(ticket, sl=pos.price_open)
                closed += 1
        return {"success": True, "closed_count": closed}

    def cancel_order(self, ticket: int) -> Dict[str, Any]:
        if ticket in self._pending_orders:
            order = self._pending_orders.pop(ticket)
            return {"success": True, "ticket": ticket, "message": f"Pending order #{ticket} cancelled"}
        return {"success": False, "error": f"Pending order #{ticket} not found"}

    def cancel_all_orders(self) -> List[Dict[str, Any]]:
        results = []
        for ticket in list(self._pending_orders.keys()):
            results.append(self.cancel_order(ticket))
        return results

    def shutdown(self) -> None:
        self._positions.clear()
        self._pending_orders.clear()
