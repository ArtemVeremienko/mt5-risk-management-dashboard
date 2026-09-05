"""
Abstract provider interfaces for Market Data and Order Execution.
Adheres to Hexagonal / Ports & Adapters architecture.
"""

from abc import ABC, abstractmethod
from typing import Dict, List, Optional, Any
from domain.models.account import AccountState
from domain.models.symbol import SymbolSpec
from domain.models.position import Position
from domain.models.trade_stats import TradeRecord


class IMarketDataProvider(ABC):
    """
    Port for market data querying, volatility calculation, and account telemetry.
    """

    @property
    @abstractmethod
    def is_connected(self) -> bool:
        """Returns True if connected to data source."""
        ...

    @property
    @abstractmethod
    def is_live(self) -> bool:
        """Returns True if connected to live MT5 broker terminal."""
        ...

    @abstractmethod
    def get_account_summary(self) -> AccountState:
        """Retrieves live account balance, equity, margin, leverage, and free margin."""
        ...

    @abstractmethod
    def get_market_symbols(self) -> List[SymbolSpec]:
        """Retrieves all Market Watch symbols with specifications and 14D ADR/ATR."""
        ...

    @abstractmethod
    def get_symbol_specs(self, symbol: str) -> Optional[SymbolSpec]:
        """Retrieves specifications for a single symbol."""
        ...

    @abstractmethod
    def fetch_closed_deals_history(self, days: Optional[int] = None) -> List[float]:
        """Fetches historical closed trade PnLs."""
        ...

    @abstractmethod
    def get_open_positions(self) -> List[Position]:
        """Retrieves all open market positions."""
        ...

    @abstractmethod
    def refresh_volatility_cache(self, symbols: Optional[List[str]] = None, force: bool = False) -> None:
        """Calculates and refreshes 14-day D1 ADR and ATR."""
        ...

    @abstractmethod
    def set_custom_trades(self, pnl_list: List[float]) -> None:
        """Overrides historical trades cache with custom CSV/manual data."""
        ...

    @abstractmethod
    def get_cached_trades(self) -> List[float]:
        """Returns recent trade PnL history."""
        ...

    @abstractmethod
    def get_cached_trade_records(self) -> Optional[List[TradeRecord]]:
        """Returns structured trade records if available."""
        ...


class IExecutionProvider(ABC):
    """
    Port for trade execution, order modification, and liquidation operations.
    """

    @abstractmethod
    def send_market_order(
        self,
        symbol: str,
        action: str,
        volume: float,
        sl_pips: float,
        rr_ratio: float = 1.0,
        comment: str = "RiskDashboard"
    ) -> Dict[str, Any]:
        """Dispatches an instant market BUY or SELL order with SL and TP."""
        ...

    @abstractmethod
    def modify_position_sltp(
        self,
        ticket: int,
        sl: Optional[float] = None,
        tp: Optional[float] = None
    ) -> Dict[str, Any]:
        """Modifies Stop Loss and/or Take Profit price levels for an open position."""
        ...

    @abstractmethod
    def close_position(
        self,
        ticket: int,
        volume: Optional[float] = None
    ) -> Dict[str, Any]:
        """Closes an open position (full or partial volume)."""
        ...

    @abstractmethod
    def close_all_positions(self) -> List[Dict[str, Any]]:
        """Closes all open positions immediately."""
        ...

    @abstractmethod
    def break_even_all_positions(self) -> Dict[str, Any]:
        """Moves Stop Loss to Universal Cost-Absorbing Break-Even for eligible positions."""
        ...

    @abstractmethod
    def close_50_all_positions(self) -> Dict[str, Any]:
        """Closes 50% volume and moves SL to Break-Even for eligible positions."""
        ...

    @abstractmethod
    def shutdown(self) -> None:
        """Releases resources, threads, and connections."""
        ...
