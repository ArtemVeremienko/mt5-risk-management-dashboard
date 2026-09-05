"""
Account domain model representing MT5 terminal account state and telemetry.
"""

from pydantic import Field, ConfigDict
from domain.models.base import DomainModel


class AccountState(DomainModel):
    """
    Immutable representation of an MT5 trading account state.
    """
    model_config = ConfigDict(frozen=True)

    balance: float = Field(default=100.0, description="Account balance in deposit currency")
    equity: float = Field(default=100.0, description="Current equity including floating P&L")
    margin: float = Field(default=0.0, description="Total margin collateral required for open positions")
    free_margin: float = Field(default=100.0, description="Free margin available for new trade execution")
    margin_level: float = Field(default=0.0, description="Margin level percentage ((equity / margin) * 100)")
    leverage: float = Field(default=300.0, description="Account default leverage (e.g. 300 for 1:300)")
    profit: float = Field(default=0.0, description="Total floating unrealized profit/loss across open positions")
    currency: str = Field(default="USD", description="Deposit base currency")
    server: str = Field(default="MetaQuotes-Demo", description="Connected broker server name")
    name: str = Field(default="Demo Account", description="Account holder name")
    login: int = Field(default=10000001, description="Account login ID")
    account_type: str = Field(default="Hedge", description="Account margin netting mode ('Hedge' or 'Netting')")
    is_live: bool = Field(default=False, description="True if connected to a real live server with MT5 IPC")
    trade_mode: str = Field(default="Demo", description="'Demo', 'Real', or 'Contest'")
    is_real: bool = Field(default=False, description="True if real money trading mode")
