"""
Application configuration settings for MT5 Risk Management Dashboard.
"""

import os
from pydantic import BaseModel, Field


class AppSettings(BaseModel):
    """
    Global application settings with environment variable fallback.
    """
    host: str = Field(default_factory=lambda: os.getenv("HOST", "127.0.0.1"))
    port: int = Field(default_factory=lambda: int(os.getenv("PORT", "8000")))
    reload: bool = Field(default_factory=lambda: os.getenv("RELOAD", "0").lower() in ("1", "true", "yes"))
    verbose: bool = Field(
        default_factory=lambda: os.getenv("VERBOSE", "0").lower() in ("1", "true", "yes")
        or os.getenv("LOG_LEVEL", "").upper() == "DEBUG"
    )
    default_stream_interval: float = Field(default=2.0, description="Normal WebSocket refresh cadence (seconds)")
    turbo_stream_interval: float = Field(default=0.5, description="Turbo mode WebSocket refresh cadence (seconds)")
    volatility_ttl_seconds: float = Field(default=900.0, description="14D ADR/ATR cache TTL (seconds)")
    market_watch_ttl_seconds: float = Field(default=5.0, description="Market watch discovery cache TTL (seconds)")
    mock_mode: bool = Field(default_factory=lambda: os.getenv("MOCK_MODE", "0").lower() in ("1", "true", "yes"))
