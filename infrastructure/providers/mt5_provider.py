"""
Native MetaTrader 5 Market Data and Execution Provider.
Communicates with terminal64.exe via MetaTrader5 Win32 C-extension
shielded by a dedicated single-threaded worker queue (MT5IPCWorker).
"""

import os
import time
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Tuple, Any

import numpy as np

try:
    import MetaTrader5 as mt5
except ImportError:
    mt5 = None

from margin_engine import resolve_margin_specs, calculate_broker_margin, get_category_leverage
from domain.models.account import AccountState
from domain.models.symbol import SymbolSpec, StepRule
from domain.models.position import Position
from domain.models.trade_stats import TradeRecord
from domain.models.break_even import BreakEvenInputs
from domain.math.break_even import calculate_break_even_price
from infrastructure.ipc.mt5_worker import MT5IPCWorker
from infrastructure.providers.base import IMarketDataProvider, IExecutionProvider
from infrastructure.providers.mock_provider import MockDataProvider, MOCK_SYMBOLS_SPECS

_log_level = logging.DEBUG if (os.getenv("VERBOSE", "").lower() in ("1", "true", "yes") or os.getenv("LOG_LEVEL", "").upper() == "DEBUG") else logging.INFO
logger = logging.getLogger("MT5Provider")
logger.setLevel(_log_level)


class MT5NativeProvider(IMarketDataProvider, IExecutionProvider):
    """
    Production-grade MetaTrader 5 Provider implementing Market Data & Execution ports.
    """

    VOLATILITY_TTL_SECONDS = 900.0   # 15 minutes TTL for 14-day D1 ADR / ATR
    MARKET_WATCH_TTL_SECONDS = 5.0   # 5 seconds TTL for Market Watch symbol list discovery

    def __init__(self, mock_mode: bool = False):
        self._is_connected = False
        self._mock_mode = mock_mode
        self._ipc_worker = MT5IPCWorker()
        self._mt5_lock = self._ipc_worker._lock
        self._mock_provider = MockDataProvider()

        # In-memory caches for high-speed sub-second polling
        self._specs_cache: Dict[str, Dict[str, Any]] = {}
        self._volatility_cache: Dict[str, Dict[str, Any]] = {}
        self._cached_symbol_names: List[str] = []
        self._last_symbol_sync_time: float = 0.0
        self._initial_risk_cache: Dict[int, Dict[str, Any]] = {}
        self._cached_trades: List[float] = []
        self._cached_trade_records: Optional[List[TradeRecord]] = None

        if not mock_mode:
            self._init_mt5()

    def shutdown(self) -> None:
        """Cleanly shut down MT5 worker queue and IPC connection."""
        try:
            self._ipc_worker.shutdown(wait=False)
        except Exception as e:
            logger.debug(f"Error shutting down MT5 worker: {e}")

    def _get_mt5(self):
        import sys
        feed_mod = sys.modules.get("feed") or sys.modules.get("risk_management_dashboard.feed")
        if feed_mod and hasattr(feed_mod, "mt5"):
            return feed_mod.mt5
        return mt5

    def _init_mt5(self) -> bool:
        mt5_lib = self._get_mt5()
        if mt5_lib is None:
            logger.warning("MetaTrader5 python package not available. Falling back to Mock Data Mode.")
            self._mock_mode = True
            self._is_connected = False
            return False

        with self._mt5_lock:
            try:
                if not mt5_lib.initialize():
                    err = mt5_lib.last_error()
                    logger.warning(f"MT5 initialize() returned False (Error: {err}). Falling back to Mock Data Mode.")
                    self._mock_mode = True
                    self._is_connected = False
                    return False

                terminal_info = mt5_lib.terminal_info()
                if terminal_info is None:
                    logger.warning("MT5 terminal info is None. Falling back to Mock Data Mode.")
                    self._mock_mode = True
                    self._is_connected = False
                    return False

                self._is_connected = True
                self._mock_mode = False
                logger.info("Successfully connected to live MT5 terminal.")
                self.refresh_volatility_cache()
                return True
            except Exception as e:
                logger.warning(f"Exception initializing MT5: {e}. Falling back to Mock Data Mode.")
                self._mock_mode = True
                self._is_connected = False
                return False

    @property
    def is_connected(self) -> bool:
        return self._is_connected

    @property
    def is_live(self) -> bool:
        return self._is_connected and not self._mock_mode

    def get_account_summary(self) -> AccountState:
        if not self.is_live:
            return self._mock_provider.get_account_summary()

        with self._mt5_lock:
            try:
                mt5_lib = self._get_mt5()
                acc = mt5_lib.account_info() if mt5_lib else None
                if acc is not None:
                    margin_mode_raw = getattr(acc, "margin_mode", 2)
                    account_type = "Netting" if margin_mode_raw in (0, 1) else "Hedge"
                    trade_mode_raw = getattr(acc, "trade_mode", 0)
                    if trade_mode_raw == 2:
                        trade_mode = "Real"
                    elif trade_mode_raw == 1:
                        trade_mode = "Contest"
                    else:
                        trade_mode = "Demo"

                    return AccountState(
                        balance=float(acc.balance),
                        equity=float(acc.equity),
                        margin=float(acc.margin),
                        free_margin=float(acc.margin_free),
                        margin_level=float(acc.margin_level) if acc.margin_level else 0.0,
                        leverage=float(acc.leverage) if acc.leverage > 0 else 300.0,
                        profit=float(acc.profit) if hasattr(acc, "profit") else 0.0,
                        currency=acc.currency or "USD",
                        server=acc.server or "MT5-Live",
                        name=acc.name or "Trader",
                        login=int(acc.login),
                        account_type=account_type,
                        is_live=True,
                        trade_mode=trade_mode,
                        is_real=(trade_mode_raw == 2)
                    )
            except Exception as e:
                logger.error(f"Error reading live account info: {e}")

        return self._mock_provider.get_account_summary()

    def _determine_category(self, symbol: str, path: str = "") -> str:
        s = symbol.upper()
        p = path.upper()

        if any(x in p for x in ["CRYPTO", "BITCOIN", "BINANCE"]) or any(x in s for x in ["BTC", "ETH", "SOL", "XRP"]):
            return "Crypto"
        if any(x in p for x in ["METAL", "PRECIOUS"]) or any(s.startswith(x) for x in ["XAU", "XAG", "XPT", "GOLD", "SILVER"]):
            return "Metals"
        if any(x in p for x in ["ENERGY", "OIL", "COMMODIT"]) or any(s.startswith(x) for x in ["USO", "UKO", "WTI", "BRENT", "NGAS"]):
            return "Energies"
        if any(x in p for x in ["INDEX", "INDICES", "EQUITIES"]) or any(x in s for x in ["US500", "US30", "USTEC", "DE40", "JP225", "NAS100", "SPX"]):
            return "Indices"
        if any(x in p for x in ["SHARE", "STOCK", "STK"]) or len(s) > 6 or "." in s:
            return "Stocks"
        if any(x in s for x in ["USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD"]) and len(s) == 6:
            majors = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD"]
            return "Forex Majors" if s in majors else "Forex Minors"
        return "Forex Majors"

    def compute_step_rule(
        self,
        symbol: str,
        category: str,
        digits: int,
        point: float,
        pip_size: float,
        stops_level: int = 0
    ) -> StepRule:
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

        stops_level_pips = (stops_level * point) / pip_size if (stops_level > 0 and pip_size > 0) else 0.0

        return StepRule(
            pip_size=pip_size,
            digits=digits,
            normal_step=round(normal_step, digits),
            fast_step=round(fast_step, digits),
            precision_step=round(precision_step, digits),
            unit_label="pips",
            stops_level_pips=round(stops_level_pips, 1)
        )

    def _calculate_adr_and_atr(self, symbol: str, point: float, digits: int, period: int = 14) -> Tuple[float, float, float]:
        pip_multiplier = 10.0 if digits in (3, 5) else 1.0
        pip_size = point * pip_multiplier if point > 0 else 0.0001
        now = time.time()

        # Check cache first
        cached = self._volatility_cache.get(symbol)
        if cached and (now - cached.get("timestamp", 0)) < self.VOLATILITY_TTL_SECONDS:
            return cached["adr_14_pips"], cached["atr_14_pips"], pip_size

        mt5_lib = self._get_mt5()
        if self.is_live and mt5_lib is not None:
            with self._mt5_lock:
                try:
                    rates = mt5_lib.copy_rates_from_pos(symbol, mt5_lib.TIMEFRAME_D1, 1, period)
                    if rates is not None and len(rates) >= 3:
                        highs = rates['high']
                        lows = rates['low']
                        closes = rates['close']

                        daily_ranges = (highs - lows) / pip_size
                        adr = float(np.mean(daily_ranges))

                        tr_list = []
                        for i in range(len(rates)):
                            h = highs[i]
                            l = lows[i]
                            hl = h - l
                            if i == 0:
                                tr = hl
                            else:
                                prev_c = closes[i - 1]
                                tr = max(hl, abs(h - prev_c), abs(l - prev_c))
                            tr_list.append(tr / pip_size)

                        atr = float(np.mean(tr_list))
                        adr_val = round(adr, 1)
                        atr_val = round(atr, 1)
                        self._volatility_cache[symbol] = {
                            "adr_14_pips": adr_val,
                            "atr_14_pips": atr_val,
                            "timestamp": now
                        }
                        return adr_val, atr_val, pip_size
                except Exception as e:
                    logger.debug(f"Error calculating ADR/ATR for {symbol}: {e}")

        # Fallback to mock / default
        default_adr = 60.0
        default_atr = 65.0
        for item in MOCK_SYMBOLS_SPECS:
            if item["symbol"] == symbol:
                default_adr = item["adr_14_pips"]
                default_atr = item["atr_14_pips"]
                break

        self._volatility_cache[symbol] = {
            "adr_14_pips": default_adr,
            "atr_14_pips": default_atr,
            "timestamp": now
        }
        return default_adr, default_atr, pip_size

    def refresh_volatility_cache(self, symbols: Optional[List[str]] = None, force: bool = False) -> None:
        now = time.time()
        mt5_lib = self._get_mt5()
        if not self.is_live or mt5_lib is None:
            for item in MOCK_SYMBOLS_SPECS:
                sym = item["symbol"]
                self._volatility_cache[sym] = {
                    "adr_14_pips": item["adr_14_pips"],
                    "atr_14_pips": item["atr_14_pips"],
                    "timestamp": now
                }
            return

        syms_to_check = symbols or self._cached_symbol_names
        for sym in syms_to_check:
            cached = self._volatility_cache.get(sym)
            if not force and cached and (now - cached.get("timestamp", 0) < self.VOLATILITY_TTL_SECONDS):
                continue

            with self._mt5_lock:
                info = mt5_lib.symbol_info(sym)
                if info is None:
                    continue
                point = info.point
                digits = info.digits

            self._calculate_adr_and_atr(sym, point, digits)

    def get_symbol_specs(self, symbol: str) -> Optional[SymbolSpec]:
        if not self.is_live:
            return self._mock_provider.get_symbol_specs(symbol)

        with self._mt5_lock:
            try:
                mt5_lib = self._get_mt5()
                if not mt5_lib:
                    return None
                tick = mt5_lib.symbol_info_tick(symbol)
                base_spec = self._specs_cache.get(symbol)

                if base_spec is None:
                    info = mt5_lib.symbol_info(symbol)
                    if info is not None:
                        digits = info.digits
                        point = info.point
                        pip_multiplier = 10.0 if digits in (3, 5) else 1.0
                        pip_size = point * pip_multiplier if point > 0 else 0.0001
                        category = self._determine_category(info.name, getattr(info, "path", ""))
                        acc = mt5_lib.account_info() if self.is_live else None
                        lev = float(acc.leverage) if (acc and acc.leverage > 0) else 2000.0
                        raw_m = None
                        try:
                            init_price = float(tick.ask) if tick and tick.ask else 1.0
                            raw_m = mt5_lib.order_calc_margin(mt5_lib.ORDER_TYPE_BUY, symbol, 1.0, init_price)
                        except Exception:
                            init_price = 1.0

                        m_specs = resolve_margin_specs(
                            symbol=info.name,
                            category=category,
                            contract_size=float(info.trade_contract_size) if info.trade_contract_size > 0 else 100000.0,
                            ask=init_price,
                            acc_leverage=lev,
                            raw_order_margin=raw_m
                        )
                        c_base = info.currency_base or (symbol[:3] if len(symbol) == 6 else "USD")
                        c_profit = info.currency_profit or (symbol[3:6] if len(symbol) == 6 else "USD")
                        c_margin = info.currency_margin or c_base

                        base_spec = {
                            "symbol": info.name,
                            "category": category,
                            "digits": digits,
                            "point": point,
                            "pip_size": pip_size,
                            "trade_contract_size": float(info.trade_contract_size) if info.trade_contract_size > 0 else 100000.0,
                            "trade_tick_value": float(info.trade_tick_value) if info.trade_tick_value > 0 else 1.0,
                            "trade_tick_size": float(info.trade_tick_size) if info.trade_tick_size > 0 else 0.00001,
                            "trade_stops_level": info.trade_stops_level,
                            "volume_min": float(info.volume_min) if info.volume_min > 0 else 0.01,
                            "volume_max": float(info.volume_max) if info.volume_max > 0 else 100.0,
                            "volume_step": float(info.volume_step) if info.volume_step > 0 else 0.01,
                            "currency_base": c_base,
                            "currency_profit": c_profit,
                            "currency_margin": c_margin,
                            "margin_per_lot": m_specs.margin_per_lot,
                            "margin_rate": m_specs.margin_rate
                        }
                        self._specs_cache[symbol] = base_spec

                if base_spec is None:
                    return None

                bid = float(tick.bid) if tick else 1.0
                ask = float(tick.ask) if tick else 1.0
                digits = base_spec["digits"]
                pip_size = base_spec["pip_size"]
                spread = round((ask - bid) / pip_size, 1) if pip_size > 0 else 0.0

                pip_val = (base_spec["trade_tick_value"] / base_spec["trade_tick_size"]) * pip_size if base_spec["trade_tick_size"] > 0 else 1.0

                vol = self._volatility_cache.get(symbol)
                adr = vol.get("adr_14_pips", 60.0) if vol else 60.0
                atr = vol.get("atr_14_pips", 65.0) if vol else 65.0

                step_rule = self.compute_step_rule(
                    symbol=symbol,
                    category=base_spec["category"],
                    digits=digits,
                    point=base_spec["point"],
                    pip_size=pip_size,
                    stops_level=base_spec.get("trade_stops_level", 0)
                )

                return SymbolSpec(
                    symbol=symbol,
                    category=base_spec["category"],
                    bid=bid,
                    ask=ask,
                    digits=digits,
                    point=base_spec["point"],
                    pip_size=pip_size,
                    trade_contract_size=base_spec["trade_contract_size"],
                    trade_tick_value=base_spec["trade_tick_value"],
                    trade_tick_size=base_spec["trade_tick_size"],
                    volume_min=base_spec["volume_min"],
                    volume_max=base_spec["volume_max"],
                    volume_step=base_spec["volume_step"],
                    pip_value_per_lot=round(pip_val, 3),
                    spread_pips=spread,
                    adr_14_pips=adr,
                    atr_14_pips=atr,
                    currency_base=base_spec.get("currency_base", "USD"),
                    currency_profit=base_spec.get("currency_profit", "USD"),
                    currency_margin=base_spec.get("currency_margin", "USD"),
                    bid_display=f"{bid:.{digits}f}",
                    ask_display=f"{ask:.{digits}f}",
                    spread_display=f"{spread:.1f}",
                    adr_display=f"{adr:.1f}",
                    atr_display=f"{atr:.1f}",
                    step_rule=step_rule,
                    margin_per_lot=base_spec.get("margin_per_lot"),
                    margin_rate=base_spec.get("margin_rate")
                )
            except Exception as e:
                logger.error(f"Error reading symbol specs for {symbol}: {e}")
                return None

    def get_market_symbols(self) -> List[SymbolSpec]:
        if not self.is_live:
            return self._mock_provider.get_market_symbols()

        now = time.time()
        if not self._cached_symbol_names or (now - self._last_symbol_sync_time > self.MARKET_WATCH_TTL_SECONDS):
            with self._mt5_lock:
                try:
                    mt5_lib = self._get_mt5()
                    symbols = mt5_lib.symbols_get() if mt5_lib else None
                    if symbols:
                        self._cached_symbol_names = [s.name for s in symbols if s.select]
                        self._last_symbol_sync_time = now
                except Exception as e:
                    logger.error(f"Error fetching symbols: {e}")

        results: List[SymbolSpec] = []
        for sym in self._cached_symbol_names:
            spec = self.get_symbol_specs(sym)
            if spec is not None:
                results.append(spec)
        return results

    def calculate_margin(self, symbol: str, lots: float, price: float, leverage: Optional[float] = None) -> Optional[float]:
        """Calculates exact broker margin scaled by volume and leverage."""
        if self.is_live:
            with self._mt5_lock:
                try:
                    mt5_lib = self._get_mt5()
                    acc = mt5_lib.account_info() if mt5_lib else None
                    acc_leverage = float(acc.leverage) if (acc and acc.leverage > 0) else 2000.0
                    spec = self.get_symbol_specs(symbol)
                    mpl = spec.margin_per_lot if spec else None
                    ref_p = spec.ask if spec else price
                    cat = spec.category if spec else ""
                    cs = spec.trade_contract_size if spec else 100000.0
                    return calculate_broker_margin(
                        symbol=symbol,
                        lots=lots,
                        price=price,
                        acc_leverage=acc_leverage,
                        user_leverage=leverage,
                        margin_per_lot=mpl,
                        ref_price=ref_p,
                        category=cat,
                        contract_size=cs
                    )
                except Exception as e:
                    logger.debug(f"calculate_margin error for {symbol}: {e}")
        return None

    def fetch_closed_deals_history(
        self,
        days: Optional[int] = None,
        symbol: Optional[str] = None,
        magic: Optional[int] = None
    ) -> List[float]:
        mt5_lib = self._get_mt5()
        if not self.is_live or mt5_lib is None:
            return self._mock_provider.fetch_closed_deals_history(days)

        with self._mt5_lock:
            try:
                now = datetime.now(timezone.utc) + timedelta(days=1)
                if days is not None:
                    from_dt = now - timedelta(days=days)
                else:
                    from_dt = datetime(1970, 1, 1, tzinfo=timezone.utc)

                deals = mt5_lib.history_deals_get(from_dt, now)
                if deals is not None and len(deals) > 0:
                    positions_map: Dict[int, Dict[str, Any]] = {}
                    for d in deals:
                        if getattr(d, 'type', 0) == 2:
                            continue
                        if symbol and getattr(d, 'symbol', '').upper() != symbol.upper():
                            continue
                        if magic is not None and getattr(d, 'magic', None) != magic:
                            continue

                        pos_id = int(getattr(d, 'position_id', 0) or getattr(d, 'ticket', 0))
                        if pos_id not in positions_map:
                            positions_map[pos_id] = {
                                "position_id": pos_id,
                                "symbol": getattr(d, 'symbol', ''),
                                "net_pnl": 0.0,
                                "is_closed": False,
                                "time": getattr(d, 'time', 0)
                            }

                        net_deal = float(getattr(d, 'profit', 0.0)) + float(getattr(d, 'swap', 0.0)) + float(getattr(d, 'commission', 0.0)) + float(getattr(d, 'fee', 0.0))
                        positions_map[pos_id]["net_pnl"] += net_deal
                        positions_map[pos_id]["time"] = max(positions_map[pos_id]["time"], getattr(d, 'time', 0))

                        if getattr(d, 'entry', 0) in (1, 2, 3) or (getattr(d, 'type', 0) in (0, 1) and getattr(d, 'profit', 0.0) != 0):
                            positions_map[pos_id]["is_closed"] = True

                    closed_positions = [
                        pos for pos in positions_map.values() if pos["is_closed"]
                    ]
                    closed_positions.sort(key=lambda x: x["time"])
                    pnl_list = [round(pos["net_pnl"], 2) for pos in closed_positions]

                    if pnl_list:
                        self._cached_trades = pnl_list
                        trade_records = []
                        for pos in closed_positions:
                            trade_records.append(TradeRecord(
                                position_id=pos["position_id"],
                                symbol=pos["symbol"] or "UNKNOWN",
                                pnl=pos["net_pnl"],
                                close_time=pos["time"]
                            ))
                        self._cached_trade_records = trade_records
                        return pnl_list
            except Exception as e:
                logger.error(f"Error fetching closed deals: {e}")

        if not self._cached_trades:
            self._cached_trades = generate_mock_trades_pnl(count=185, win_rate=0.56, payoff_ratio=1.45)
            now_ts = int(time.time())
            self._cached_trade_records = [
                TradeRecord(
                    position_id=10000 + i,
                    symbol="EURUSD",
                    pnl=p,
                    close_time=now_ts - (185 - i) * 600
                )
                for i, p in enumerate(self._cached_trades)
            ]
        return self._cached_trades

    def set_custom_trades(self, pnl_list: List[float]) -> None:
        self._cached_trades = list(pnl_list)
        self._cached_trade_records = None
        self._mock_provider.set_custom_trades(pnl_list)

    def get_cached_trades(self) -> List[float]:
        return self._cached_trades or self._mock_provider.get_cached_trades()

    def get_cached_trade_records(self) -> Optional[List[TradeRecord]]:
        return self._cached_trade_records

    def get_open_positions(self) -> List[Position]:
        mt5_lib = self._get_mt5()
        if not self.is_live or mt5_lib is None:
            return self._mock_provider.get_open_positions()

        with self._mt5_lock:
            try:
                positions = mt5_lib.positions_get()
                if positions is None:
                    return []

                current_tickets = set()
                res: List[Position] = []

                for p in positions:
                    ticket = int(p.ticket)
                    current_tickets.add(ticket)
                    pos_type_str = "BUY" if p.type == mt5_lib.ORDER_TYPE_BUY else "SELL"
                    digits = 5
                    pip_size = 0.0001
                    info = mt5_lib.symbol_info(p.symbol)
                    if info:
                        digits = info.digits
                        point = info.point
                        pip_mult = 10.0 if digits in (3, 5) else 1.0
                        pip_size = point * pip_mult if point > 0 else 0.0001

                    is_buy = (pos_type_str == "BUY")
                    pnl_pips = (p.price_current - p.price_open) / pip_size if is_buy else (p.price_open - p.price_current) / pip_size

                    is_sl_in_profit = False
                    sl_pips_profit = 0.0
                    if p.sl and p.sl > 0:
                        sl_diff = (p.sl - p.price_open) if is_buy else (p.price_open - p.sl)
                        sl_pips_profit = sl_diff / pip_size
                        if sl_pips_profit >= 0:
                            is_sl_in_profit = True

                    initial_sl = 0.0
                    initial_risk_pips = 0.0
                    if ticket in self._initial_risk_cache:
                        initial_sl = float(self._initial_risk_cache[ticket].get("initial_sl", 0.0))
                        initial_risk_pips = float(self._initial_risk_cache[ticket].get("initial_risk_pips", 0.0))
                        if initial_risk_pips == 0.0 and initial_sl > 0:
                            initial_risk_pips = abs(p.price_open - initial_sl) / pip_size
                    elif p.sl and p.sl > 0:
                        initial_sl = p.sl
                        initial_risk_pips = abs(p.price_open - p.sl) / pip_size
                        self._initial_risk_cache[ticket] = {
                            "initial_sl": initial_sl,
                            "initial_risk_pips": initial_risk_pips
                        }

                    r_multiple = round(pnl_pips / initial_risk_pips, 2) if initial_risk_pips > 0 else None
                    locked_r = round(sl_pips_profit / initial_risk_pips, 2) if (is_sl_in_profit and initial_risk_pips > 0) else 0.0

                    category = self._determine_category(p.symbol, getattr(info, "path", ""))
                    point = getattr(info, "point", 0.00001 if digits == 5 else 0.001)
                    stops_level = getattr(info, "trade_stops_level", 0)

                    step_rule = self.compute_step_rule(
                        symbol=p.symbol,
                        category=category,
                        digits=digits,
                        point=point,
                        pip_size=pip_size,
                        stops_level=stops_level
                    )

                    res.append(Position(
                        ticket=ticket,
                        symbol=p.symbol,
                        type=pos_type_str,
                        volume=float(p.volume),
                        price_open=round(float(p.price_open), digits),
                        price_current=round(float(p.price_current), digits),
                        sl=round(float(p.sl), digits) if getattr(p, "sl", None) else 0.0,
                        tp=round(float(p.tp), digits) if getattr(p, "tp", None) else 0.0,
                        initial_sl=round(float(initial_sl), digits) if initial_sl > 0 else 0.0,
                        is_sl_in_profit=is_sl_in_profit,
                        locked_r=locked_r,
                        profit=round(float(getattr(p, "profit", 0.0)), 2),
                        swap=round(float(getattr(p, "swap", 0.0)), 2),
                        pnl_pips=round(float(pnl_pips), 1),
                        r_multiple=r_multiple,
                        comment=getattr(p, "comment", "") or "",
                        magic=int(getattr(p, "magic", 0)),
                        time=int(getattr(p, "time", 0)),
                        digits=digits,
                        pip_size=pip_size,
                        step_rule=step_rule
                    ))

                # Cleanup closed positions
                stale_tickets = [t for t in self._initial_risk_cache if t not in current_tickets]
                for t in stale_tickets:
                    del self._initial_risk_cache[t]

                return res
            except Exception as e:
                logger.error(f"Error in get_open_positions: {e}")
                return []

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

        mt5_lib = self._get_mt5()
        if not self.is_live or mt5_lib is None:
            return self._mock_provider.send_market_order(symbol, action_upper, volume, sl_pips, rr_ratio, comment)

        with self._mt5_lock:
            try:
                tick = mt5_lib.symbol_info_tick(symbol)
                info = mt5_lib.symbol_info(symbol)
                if not tick or not info:
                    return {"success": False, "error": f"Unable to get market quote for {symbol}"}

                is_buy = action_upper == "BUY"
                order_type = mt5_lib.ORDER_TYPE_BUY if is_buy else mt5_lib.ORDER_TYPE_SELL
                price = float(tick.ask) if is_buy else float(tick.bid)

                digits = info.digits
                point = info.point
                pip_mult = 10.0 if digits in (3, 5) else 1.0
                pip_size = point * pip_mult if point > 0 else 0.0001

                if is_buy:
                    sl_price = round(price - (sl_pips * pip_size), digits)
                    tp_price = round(price + (sl_pips * rr_ratio * pip_size), digits) if rr_ratio > 0 else 0.0
                else:
                    sl_price = round(price + (sl_pips * pip_size), digits)
                    tp_price = round(price - (sl_pips * rr_ratio * pip_size), digits) if rr_ratio > 0 else 0.0

                req = {
                    "action": mt5_lib.TRADE_ACTION_DEAL,
                    "symbol": symbol,
                    "volume": float(volume),
                    "type": order_type,
                    "price": price,
                    "sl": sl_price,
                    "tp": tp_price,
                    "deviation": 20,
                    "magic": 123456,
                    "comment": comment,
                    "type_time": mt5_lib.ORDER_TIME_GTC,
                    "type_filling": mt5_lib.ORDER_FILLING_IOC,
                }

                result = mt5_lib.order_send(req)
                if result is None:
                    err = mt5_lib.last_error()
                    return {"success": False, "error": f"order_send failed with code {err}"}

                if result.retcode != mt5_lib.TRADE_RETCODE_DONE:
                    # Retry with RETURN filling mode if IOC rejected
                    if result.retcode in (mt5_lib.TRADE_RETCODE_INVALID_FILL, mt5_lib.TRADE_RETCODE_REJECT):
                        req["type_filling"] = mt5_lib.ORDER_FILLING_RETURN
                        result = mt5_lib.order_send(req)

                if result and result.retcode == mt5_lib.TRADE_RETCODE_DONE:
                    ticket = int(result.order)
                    self._initial_risk_cache[ticket] = {
                        "initial_sl": sl_price,
                        "initial_risk_pips": sl_pips
                    }
                    return {
                        "success": True,
                        "ticket": ticket,
                        "action": action_upper,
                        "retcode": result.retcode,
                        "price": result.price,
                        "volume": result.volume,
                        "sl": sl_price,
                        "tp": tp_price,
                        "message": "Order executed successfully"
                    }
                else:
                    ret_code = result.retcode if result else "Unknown"
                    ret_comment = result.comment if result else ""
                    return {"success": False, "retcode": ret_code, "error": f"Execution error: {ret_comment} ({ret_code})"}
            except Exception as e:
                logger.error(f"send_market_order error: {e}")
                return {"success": False, "error": str(e)}

    def modify_position_sltp(
        self,
        ticket: int,
        sl: Optional[float] = None,
        tp: Optional[float] = None
    ) -> Dict[str, Any]:
        mt5_lib = self._get_mt5()
        if not self.is_live or mt5_lib is None:
            return self._mock_provider.modify_position_sltp(ticket, sl, tp)

        with self._mt5_lock:
            try:
                positions = mt5_lib.positions_get(ticket=ticket)
                if not positions:
                    return {"success": False, "error": f"Position #{ticket} not found"}

                pos = positions[0]
                symbol = pos.symbol
                info = mt5_lib.symbol_info(symbol)
                digits = info.digits if info else 5

                new_sl = round(float(sl), digits) if (sl is not None and sl > 0) else float(pos.sl)
                new_tp = round(float(tp), digits) if (tp is not None and tp > 0) else float(pos.tp)

                req = {
                    "action": mt5_lib.TRADE_ACTION_SLTP,
                    "position": ticket,
                    "symbol": symbol,
                    "sl": new_sl,
                    "tp": new_tp
                }

                result = mt5_lib.order_send(req)
                if result and result.retcode == mt5_lib.TRADE_RETCODE_DONE:
                    return {"success": True, "ticket": ticket, "sl": new_sl, "tp": new_tp}
                else:
                    code = result.retcode if result else mt5_lib.last_error()
                    comm = result.comment if result else "Order modify failed"
                    return {"success": False, "error": f"{comm} (retcode: {code})"}
            except Exception as e:
                logger.error(f"modify_position_sltp error: {e}")
                return {"success": False, "error": str(e)}

    def close_position(
        self,
        ticket: int,
        volume: Optional[float] = None
    ) -> Dict[str, Any]:
        mt5_lib = self._get_mt5()
        if not self.is_live or mt5_lib is None:
            return self._mock_provider.close_position(ticket, volume)

        with self._mt5_lock:
            try:
                positions = mt5_lib.positions_get(ticket=ticket)
                if not positions:
                    return {"success": False, "error": f"Position #{ticket} not found"}

                pos = positions[0]
                symbol = pos.symbol
                pos_vol = float(pos.volume)
                close_vol = min(float(volume), pos_vol) if volume is not None and volume > 0 else pos_vol

                tick = mt5_lib.symbol_info_tick(symbol)
                if not tick:
                    return {"success": False, "error": f"No tick price for {symbol}"}

                is_buy = (pos.type == mt5_lib.ORDER_TYPE_BUY)
                opp_type = mt5_lib.ORDER_TYPE_SELL if is_buy else mt5_lib.ORDER_TYPE_BUY
                price = float(tick.bid) if is_buy else float(tick.ask)

                req = {
                    "action": mt5_lib.TRADE_ACTION_DEAL,
                    "position": ticket,
                    "symbol": symbol,
                    "volume": close_vol,
                    "type": opp_type,
                    "price": price,
                    "deviation": 20,
                    "magic": 123456,
                    "comment": "Close Position",
                    "type_time": mt5_lib.ORDER_TIME_GTC,
                    "type_filling": mt5_lib.ORDER_FILLING_IOC
                }

                result = mt5_lib.order_send(req)
                if result and result.retcode != mt5_lib.TRADE_RETCODE_DONE:
                    if result.retcode in (mt5_lib.TRADE_RETCODE_INVALID_FILL, mt5_lib.TRADE_RETCODE_REJECT):
                        req["type_filling"] = mt5_lib.ORDER_FILLING_RETURN
                        result = mt5_lib.order_send(req)

                if result and result.retcode == mt5_lib.TRADE_RETCODE_DONE:
                    if ticket in self._initial_risk_cache and close_vol >= pos_vol:
                        del self._initial_risk_cache[ticket]
                    return {
                        "success": True,
                        "ticket": ticket,
                        "closed_volume": close_vol,
                        "remaining_volume": max(0.0, round(pos_vol - close_vol, 2)),
                        "price": getattr(result, "price", price)
                    }
                else:
                    code = result.retcode if result else mt5_lib.last_error()
                    comm = result.comment if result else "Close order rejected"
                    return {"success": False, "error": f"{comm} (retcode: {code})"}
            except Exception as e:
                logger.error(f"close_position error: {e}")
                return {"success": False, "error": str(e)}

    def close_all_positions(self) -> List[Dict[str, Any]]:
        positions = self.get_open_positions()
        results = []
        for pos in positions:
            res = self.close_position(pos.ticket)
            results.append(res)
        return results

    def calculate_universal_be_price(self, ticket: int) -> Dict[str, Any]:
        """
        Calculates the universal cost-absorbing Break-Even price for an open position across
        Forex, Equities, Metals, Indices, and Crypto by factoring in:
        1. Entry Commission & Broker Fees (from mt5.history_deals_get)
        2. Accumulated Swap/Financing in account currency
        3. Real-time Spread cost
        4. Nominal Safety Pad ($1.00 or 0.5 pip equivalent)
        """
        mt5_lib = self._get_mt5()
        if not self.is_live or mt5_lib is None:
            return {"success": False, "message": "MT5 not connected"}

        with self._mt5_lock:
            try:
                positions = mt5_lib.positions_get(ticket=ticket)
                if not positions or len(positions) == 0:
                    return {"success": False, "message": f"Position #{ticket} not found"}

                pos = positions[0]
                symbol = pos.symbol
                info = mt5_lib.symbol_info(symbol)
                tick = mt5_lib.symbol_info_tick(symbol)
                if not info or not tick:
                    return {"success": False, "message": f"Could not retrieve spec for {symbol}"}

                digits = info.digits
                point = info.point if info.point > 0 else 0.00001
                tick_size = info.trade_tick_size if info.trade_tick_size > 0 else point
                tick_val = info.trade_tick_value if info.trade_tick_value > 0 else 1.0
                pip_multiplier = 10.0 if digits in (3, 5) else 1.0
                pip_size = point * pip_multiplier

                vol = float(pos.volume)
                point_val_for_pos = (tick_val / tick_size) * vol if (tick_size > 0 and vol > 0) else 10.0

                # 1. Commission Calculation
                commission_total = 0.0
                fee_total = 0.0
                try:
                    deals = mt5_lib.history_deals_get(position=ticket)
                    if deals and len(deals) > 0:
                        for d in deals:
                            if getattr(d, 'entry', 0) in (0, 1):
                                commission_total += abs(float(getattr(d, 'commission', 0.0)))
                                fee_total += abs(float(getattr(d, 'fee', 0.0)))
                        if len(deals) == 1:
                            commission_total = commission_total * 2.0
                except Exception as c_err:
                    logger.debug(f"Could not query deals for #{ticket}: {c_err}")

                # 2. Swap in account currency
                swap_cost = abs(float(pos.swap)) if pos.swap < 0 else 0.0

                # 3. Live Spread Cost
                spread_points = (tick.ask - tick.bid) if (tick.ask and tick.bid) else (info.spread * point)
                spread_dollars = (spread_points / tick_size) * tick_val * vol if tick_size > 0 else (5.0 * vol)

                # 4. Nominal Safety Pad ($0.50 - $1.00 or 0.5 pip equivalent)
                pip_val_for_pos = (pip_size / tick_size) * tick_val * vol if tick_size > 0 else (10.0 * vol)
                safety_pad_dollars = max(1.0, 0.5 * pip_val_for_pos)

                # Total Cost to Absorb
                total_cost_dollars = commission_total + fee_total + swap_cost + spread_dollars + safety_pad_dollars

                # Exact Price Offset Required
                price_offset = total_cost_dollars / point_val_for_pos if point_val_for_pos > 0 else (spread_points + 0.5 * pip_size)

                # Calculate Target BE Price
                is_buy = (pos.type == mt5_lib.ORDER_TYPE_BUY)
                if is_buy:
                    target_be = float(pos.price_open) + price_offset
                    curr_price = float(tick.bid)
                    is_profitable = (curr_price > target_be + (info.trade_stops_level * point))
                else:
                    target_be = float(pos.price_open) - price_offset
                    curr_price = float(tick.ask)
                    is_profitable = (curr_price < target_be - (info.trade_stops_level * point))

                rounded_be = round(target_be, digits)

                return {
                    "success": True,
                    "ticket": ticket,
                    "symbol": symbol,
                    "type": "BUY" if is_buy else "SELL",
                    "price_open": float(pos.price_open),
                    "current_price": curr_price,
                    "target_be_price": rounded_be,
                    "is_profitable": is_profitable,
                    "commission_cost": round(commission_total + fee_total, 2),
                    "swap_cost": round(swap_cost, 2),
                    "spread_dollars": round(spread_dollars, 2),
                    "total_cost_absorbed": round(total_cost_dollars, 2),
                    "stops_level": info.trade_stops_level
                }
            except Exception as e:
                logger.error(f"Error calculating universal BE price for #{ticket}: {e}")
                return {"success": False, "message": str(e)}

    def break_even_all_positions(self) -> Dict[str, Any]:
        """
        Intelligently snaps Stop Loss to Universal Cost-Absorbing Break-Even for all
        eligible profitable open positions across Forex, Stocks, Metals, Indices, and Crypto.
        Safely skips trades in loss or insufficient profit.
        """
        mt5_lib = self._get_mt5()
        if not self.is_live or mt5_lib is None:
            return self._mock_provider.break_even_all_positions()

        positions = self.get_open_positions()
        modified_count = 0
        skipped_count = 0
        results = []

        for p in positions:
            ticket = p.ticket if hasattr(p, "ticket") else p["ticket"]
            symbol = p.symbol if hasattr(p, "symbol") else p["symbol"]
            tp = p.tp if hasattr(p, "tp") else p.get("tp")

            be_calc = self.calculate_universal_be_price(ticket)
            if not be_calc.get("success"):
                results.append({"ticket": ticket, "success": False, "message": be_calc.get("message")})
                skipped_count += 1
                continue

            if not be_calc.get("is_profitable", False):
                results.append({
                    "ticket": ticket,
                    "symbol": symbol,
                    "success": False,
                    "skipped": True,
                    "reason": "Not sufficiently profitable to cover spread + commissions",
                    "current_price": be_calc.get("current_price"),
                    "target_be": be_calc.get("target_be_price")
                })
                skipped_count += 1
                continue

            target_be = be_calc["target_be_price"]
            mod_res = self.modify_position_sltp(ticket=ticket, sl=target_be, tp=tp)
            if mod_res.get("success"):
                modified_count += 1
                results.append({
                    "ticket": ticket,
                    "symbol": symbol,
                    "success": True,
                    "target_be": target_be,
                    "message": f"BE locked at {target_be} (absorbed ${be_calc['total_cost_absorbed']} fees)"
                })
            else:
                skipped_count += 1
                results.append(mod_res)

        return {
            "success": True,
            "count_modified": modified_count,
            "count_skipped": skipped_count,
            "total_positions": len(positions),
            "results": results
        }

    def close_50_all_positions(self) -> Dict[str, Any]:
        """
        Executes TP1 (Take Profit 1) workflow across all profitable positions:
        1. Closes 50% volume (clamped to broker steps).
        2. Automatically snaps the remaining volume's Stop Loss to universal Break-Even.
        3. If position is at minimum lot (e.g. 0.01 lot), preserves volume and moves SL to BE.
        """
        mt5_lib = self._get_mt5()
        if not self.is_live or mt5_lib is None:
            return self._mock_provider.close_50_all_positions()

        positions = self.get_open_positions()
        scaled_out_count = 0
        be_locked_count = 0
        skipped_count = 0
        results = []

        for p in positions:
            ticket = p.ticket if hasattr(p, "ticket") else p["ticket"]
            symbol = p.symbol if hasattr(p, "symbol") else p["symbol"]
            volume = p.volume if hasattr(p, "volume") else p["volume"]
            tp = p.tp if hasattr(p, "tp") else p.get("tp")

            be_calc = self.calculate_universal_be_price(ticket)

            if not be_calc.get("is_profitable", False):
                skipped_count += 1
                results.append({
                    "ticket": ticket,
                    "symbol": symbol,
                    "success": False,
                    "skipped": True,
                    "reason": "Position in drawdown / not sufficiently in profit for TP1"
                })
                continue

            target_be = be_calc.get("target_be_price")

            info = mt5_lib.symbol_info(symbol) if (self._is_connected and mt5_lib) else None
            vol_min = float(info.volume_min) if (info and hasattr(info, "volume_min") and info.volume_min > 0) else 0.01
            vol_step = float(info.volume_step) if (info and hasattr(info, "volume_step") and info.volume_step > 0) else 0.01

            curr_vol = float(volume)
            half_vol_raw = curr_vol / 2.0

            if curr_vol <= vol_min:
                mod_res = self.modify_position_sltp(ticket=ticket, sl=target_be, tp=tp)
                if mod_res.get("success"):
                    be_locked_count += 1
                    results.append({
                        "ticket": ticket,
                        "symbol": symbol,
                        "success": True,
                        "action": "BE_ONLY_MIN_LOT",
                        "message": f"Min volume ({curr_vol} lots): Preserved full volume and locked SL at {target_be}"
                    })
                else:
                    skipped_count += 1
                    results.append(mod_res)
            else:
                steps = round(half_vol_raw / vol_step)
                close_vol = max(vol_min, round(steps * vol_step, 6))

                close_res = self.close_position(ticket=ticket, volume=close_vol)
                if close_res.get("success"):
                    scaled_out_count += 1
                    mod_res = self.modify_position_sltp(ticket=ticket, sl=target_be, tp=tp)
                    if mod_res.get("success"):
                        be_locked_count += 1
                    results.append({
                        "ticket": ticket,
                        "symbol": symbol,
                        "success": True,
                        "action": "SCALED_OUT_AND_BE",
                        "closed_volume": close_vol,
                        "target_be": target_be,
                        "message": f"Closed {close_vol} lots and moved SL to BE ({target_be})"
                    })
                else:
                    skipped_count += 1
                    results.append(close_res)

        return {
            "success": True,
            "count_scaled_out": scaled_out_count,
            "count_be_locked": be_locked_count,
            "count_skipped": skipped_count,
            "total_positions": len(positions),
            "results": results
        }
