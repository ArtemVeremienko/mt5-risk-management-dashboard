"""
Base immutable domain model for MT5 Risk Management Dashboard.
Provides frozen Pydantic v2 domain model semantics across all domain entities.
"""

from pydantic import BaseModel, ConfigDict


class DomainModel(BaseModel):
    """
    Base immutable domain model ensuring strict typing and immutability.
    """
    model_config = ConfigDict(frozen=True)
