"""
Domain Gatekeeper: Pure, stateless pre-trade risk and safety validation rules.
Zero MT5 dependencies, zero I/O, 100% unit-testable.
"""

from typing import Optional, Tuple


class PreTradeRiskViolation(Exception):
    """Raised when an order violates pre-trade risk parameters."""
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class PreTradeGatekeeper:
    """
    Stateless quantitative risk checks executed prior to order transmission.
    """

    @staticmethod
    def validate_spread(
        current_spread_pips: float,
        median_spread_pips: float,
        max_multiplier: float = 2.5
    ) -> Tuple[bool, Optional[str]]:
        """
        Guards against high slippage during liquidity gaps, rollover, or news spikes.
        Rejects order if current_spread > max_multiplier * median_spread.
        """
        if median_spread_pips <= 0:
            return True, None

        threshold = median_spread_pips * max_multiplier
        if current_spread_pips > threshold:
            return False, f"Spread blowout: {current_spread_pips:.1f} pips exceeds {max_multiplier}x median ({threshold:.1f} pips)"
        return True, None

    @staticmethod
    def validate_margin_health(
        required_margin: float,
        free_margin: float,
        max_margin_usage_ratio: float = 0.95
    ) -> Tuple[bool, Optional[str]]:
        """
        Guards against account stop-out / liquidation by ensuring order margin
        does not exceed a safe percentage (e.g. 95%) of available free margin.
        """
        if free_margin <= 0:
            return False, f"Zero or negative free margin (${free_margin:.2f}); cannot open position"

        max_allowed_margin = free_margin * max_margin_usage_ratio
        if required_margin > max_allowed_margin:
            return False, f"Required margin (${required_margin:.2f}) exceeds {int(max_margin_usage_ratio * 100)}% of free margin (${free_margin:.2f})"
        return True, None

    @staticmethod
    def validate_volume_limits(
        volume: float,
        volume_min: float,
        volume_max: float,
        volume_step: float
    ) -> Tuple[bool, Optional[str]]:
        """
        Validates lot volume against broker constraints.
        """
        if volume < volume_min:
            return False, f"Volume {volume} is below broker minimum {volume_min}"
        if volume > volume_max:
            return False, f"Volume {volume} exceeds broker maximum {volume_max}"

        # Check volume step alignment
        if volume_step > 0:
            steps = round(volume / volume_step, 6)
            if abs(steps - round(steps)) > 1e-4:
                return False, f"Volume {volume} is not a valid multiple of step size {volume_step}"

        return True, None
