/**
 * Global Constants & Configuration Schema for MT5 Risk Terminal.
 * Centralizes localStorage keys, safety thresholds, and institutional terminal defaults.
 */

export const STORAGE_KEYS = {
  RESERVE_DELTA: 'mt5_risk_reserve_delta',
  LEGACY_WORKING_CAPITAL: 'mt5_risk_working_capital',
  RISK_METHOD: 'mt5_risk_method',
  CUSTOM_RISK_PCT: 'mt5_risk_custom_pct',
  MIN_RISK_FLOOR: 'mt5_min_risk_floor',
  MAX_RISK_CEILING: 'mt5_max_risk_ceiling',
  MONTHLY_INCOME_TARGET: 'mt5_monthly_income_target',
  SL_MODE: 'mt5_risk_sl_mode',
  RR_RATIO: 'mt5_risk_rr_ratio',
  TURBO_MODE: 'mt5_turbo_mode',
  ONE_CLICK: 'mt5_risk_one_click',
  ACTIVE_VIEW: 'mt5_active_view',
  PNL_DISPLAY_MODE: 'mt5_pnl_display_mode',
  COLORWAY: 'mt5_colorway',
  SHOW_STATS_BANNER: 'mt5_show_stats_banner',
  PINNED_SYMBOLS: 'mt5_pinned_symbols',
  CUSTOM_SYMBOL_ORDER: 'mt5_custom_symbol_order',
  SL_OVERRIDES: 'mt5_sl_overrides',
  SLTP_DEFAULT_FOCUS: 'mt5_sltp_default_focus',
} as const;

export const RISK_CONSTANTS = {
  /** Maximum allowable deviation between effective risk and target risk before warning icon fires */
  RISK_ALERT_TOLERANCE: 0.10,
  /** Spread surge multiplier relative to rolling median spread */
  SPREAD_SURGE_THRESHOLD: 2.0,
  /** Pre-flight safety check: maximum allowable margin utilization of free margin */
  MAX_MARGIN_UTILIZATION: 0.95,
  /** Countdown timeout (ms) for armed 2-phase execution confirmation */
  ARMED_DWELL_TIMEOUT_MS: 5000,
  /** Default account leverage when not provided by broker telemetry */
  DEFAULT_ACCOUNT_LEVERAGE: 300,
  /** Default working capital fallback amount */
  DEFAULT_WORKING_CAPITAL: 100.0,
  /** Default deposited cash baseline for margin stress checking */
  DEFAULT_DEPOSITED_CASH: 20.0,
} as const;
