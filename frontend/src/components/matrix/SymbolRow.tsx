import { Component, Show, createSignal, createMemo, createEffect, onCleanup } from 'solid-js';
import { CalculatedSymbolResult } from '../../types';
import { marketStore } from '../../stores/marketStore';
import { preferencesStore } from '../../stores/preferencesStore';
import { accountStore } from '../../stores/accountStore';
import { positionsStore } from '../../stores/positionsStore';
import { computeDefaultSlPips } from '../../utils/lotCalculator';
import { RISK_CONSTANTS } from '../../config/constants';
import { MicroSparkline } from './MicroSparkline';

interface Props {
  symbol: string;
  onTradeClick: (
    item: CalculatedSymbolResult,
    action: 'BUY' | 'SELL',
    clientOrderId?: string
  ) => Promise<{ success: boolean; message?: string } | void> | void;
  onOpenDeepDive: (item: CalculatedSymbolResult) => void;
}

export const SymbolRow: Component<Props> = (props) => {
  const item = createMemo(() => marketStore.getCalculatedResult(props.symbol));

  const isPinned = () => preferencesStore.isPinned(props.symbol);
  const isDragging = () => marketStore.draggedSymbol() === props.symbol;
  const isDragOver = () => marketStore.dragOverSymbol() === props.symbol;
  const [isRowHovered, setIsRowHovered] = createSignal(false);
  const [isAdrHovered, setIsAdrHovered] = createSignal(false);

  const defaultSL = createMemo<number>(() => {
    const d = item();
    return computeDefaultSlPips(d?.spec, preferencesStore.slMode());
  });

  const activeSL = createMemo<number>(() => {
    const override = preferencesStore.slOverrides()[props.symbol];
    if (override !== undefined && !isNaN(override) && override > 0) {
      return override;
    }
    return defaultSL();
  });

  const isCustomSL = createMemo<boolean>(() => {
    const override = preferencesStore.slOverrides()[props.symbol];
    return override !== undefined && !isNaN(override) && Math.abs(override - defaultSL()) >= 0.0001;
  });

  const [isFocused, setIsFocused] = createSignal(false);
  const [localVal, setLocalVal] = createSignal<string>(activeSL().toString());

  // Sync local input with active SL only when user is NOT actively typing
  createEffect(() => {
    const sl = activeSL();
    if (!isFocused()) {
      setLocalVal(sl.toString());
    }
  });

  const handleSlCommit = (inputStr: string, isDraft: boolean = false) => {
    const val = parseFloat(inputStr);
    const def = defaultSL();
    if (isNaN(val) || val <= 0) {
      if (!isDraft) {
        preferencesStore.resetSymbolSL(props.symbol);
        setLocalVal(def.toString());
      }
      return;
    }
    if (Math.abs(val - def) < 0.0001) {
      preferencesStore.resetSymbolSL(props.symbol);
      if (!isDraft) {
        setLocalVal(def.toString());
      }
    } else {
      preferencesStore.setSymbolSL(props.symbol, val);
    }
  };

  // Smart risk alert: only warn if broker lot clamping caused risk to overshoot/undershoot by > 10%
  const isRiskDeviated = createMemo(() => {
    const d = item();
    if (!d) return false;
    const target = d.calc.target_risk_pct || 1.0;
    const effective = d.calc.effective_risk_pct || 1.0;
    return Math.abs(effective - target) / target > RISK_CONSTANTS.RISK_ALERT_TOLERANCE;
  });

  // Max Risk Per Trade Safety Ceiling Guard
  const isMaxRiskExceeded = createMemo(() => {
    const d = item();
    if (!d) return false;
    const maxCeiling = preferencesStore.maxRiskCeilingPct();
    const effective = d.calc.effective_risk_pct || 1.0;
    return effective > maxCeiling + 0.001;
  });

  // Spread Surge Guard: rolling median check
  const isSpreadSurge = createMemo(() => {
    const d = item();
    if (!d) return false;
    const med = d.spec.median_spread_pips;
    return med !== undefined && med !== null && med > 0 && d.spec.spread_pips > med * RISK_CONSTANTS.SPREAD_SURGE_THRESHOLD;
  });

  // Pre-Flight Margin Check: required margin <= 95% of available free margin
  const isMarginInsufficient = createMemo(() => {
    const d = item();
    if (!d) return false;
    const free = accountStore.account().free_margin;
    if (free === undefined || free === null || free <= 0) return false;
    const req = d.calc.required_margin || 0;
    return req > free * RISK_CONSTANTS.MAX_MARGIN_UTILIZATION;
  });

  // Dynamic risk & margin display respecting PnL display mode (Currency vs. R-Multiple vs. Stealth Mask)
  const effectiveRiskDisplay = createMemo(() => {
    const d = item();
    if (!d) return '';
    const mode = preferencesStore.pnlDisplayMode();
    const riskAmount = d.calc.effective_risk_amount || 0;
    const riskPct = d.calc.effective_risk_pct || 0;
    const riskPctDisplay = d.calc.effective_risk_pct_display || riskPct.toFixed(2);

    if (mode === 'stealth_mask') {
      return `•••••• (${riskPctDisplay}%)`;
    }
    if (mode === 'r_multiple') {
      const oneR = positionsStore.oneRCash();
      const riskR = oneR > 0 ? riskAmount / oneR : (riskPct / (preferencesStore.customRiskPct() || 1.0));
      return `${riskR.toFixed(2)} R (${riskPctDisplay}%)`;
    }
    return d.calc.risk_display || `$${riskAmount.toFixed(2)} (${riskPctDisplay}%)`;
  });

  const marginDisplay = createMemo(() => {
    const d = item();
    if (!d) return '';
    const mode = preferencesStore.pnlDisplayMode();
    const reqMargin = d.calc.required_margin || 0;
    const reqMarginDisplay = d.calc.required_margin_display || reqMargin.toFixed(2);
    const marginUtilPct = d.calc.margin_utilization_pct || 0;

    if (mode === 'stealth_mask') {
      return 'Margin: ••••••';
    }
    if (mode === 'r_multiple') {
      return `Margin: ${marginUtilPct.toFixed(1)}%`;
    }
    return `Margin: $${reqMarginDisplay}`;
  });

  const riskCellTooltip = createMemo(() => {
    const d = item();
    if (!d) return 'Click to view deep dive analysis';
    const riskAmount = (d.calc.effective_risk_amount || 0).toFixed(2);
    const reqMargin = d.calc.required_margin_display || '0.00';
    const oneR = positionsStore.oneRCash();
    const riskR = oneR > 0 ? ((d.calc.effective_risk_amount || 0) / oneR).toFixed(2) : '1.00';
    const marginUtilPct = (d.calc.margin_utilization_pct || 0).toFixed(1);
    return `Click to view deep dive analysis · Risk: $${riskAmount} (${riskR} R) · Margin: $${reqMargin} (${marginUtilPct}% of deposit)`;
  });

  // 5-State Execution Button Engine & Dual-Arm Safety State Machine
  const [armedAction, setArmedAction] = createSignal<'BUY' | 'SELL' | null>(null);
  const [buttonState, setButtonState] = createSignal<'resting' | 'armed' | 'inflight' | 'flash_success' | 'flash_error'>('resting');
  let armedTimer: ReturnType<typeof setTimeout> | undefined;
  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  // GPU Tick Flash-Decay Micro-Animation Engine (docs/01 §5.3)
  const [tickDirection, setTickDirection] = createSignal<'up' | 'down' | null>(null);
  let prevBid: number | null = null;
  let tickFlashTimer: ReturnType<typeof setTimeout> | undefined;

  createEffect(() => {
    const d = item();
    if (!d) return;
    const curBid = d.spec.bid;
    if (prevBid !== null && curBid !== prevBid) {
      const dir = curBid > prevBid ? 'up' : 'down';
      setTickDirection(dir);
      if (tickFlashTimer) clearTimeout(tickFlashTimer);
      tickFlashTimer = setTimeout(() => {
        setTickDirection(null);
      }, 350);
    }
    prevBid = curBid;
  });

  const disarm = () => {
    if (armedTimer) clearTimeout(armedTimer);
    setArmedAction(null);
    if (buttonState() === 'armed') {
      setButtonState('resting');
    }
  };

  createEffect(() => {
    if (armedAction()) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          disarm();
        }
      };
      const handleClickOutside = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (!target.closest(`.trade-btn-group-${props.symbol}`)) {
          disarm();
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('click', handleClickOutside);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('click', handleClickOutside);
      };
    }
  });

  onCleanup(() => {
    if (armedTimer) clearTimeout(armedTimer);
    if (flashTimer) clearTimeout(flashTimer);
    if (tickFlashTimer) clearTimeout(tickFlashTimer);
  });

  const handleExecute = async (e: MouseEvent, action: 'BUY' | 'SELL') => {
    e.stopPropagation();
    const d = item();
    if (!d || isMarginInsufficient()) return;

    // Dual-Arm Safety Gate:
    // First click transitions row button to ARMED with 5.0s decaying dwell
    if (armedAction() !== action) {
      if (armedTimer) clearTimeout(armedTimer);
      setArmedAction(action);
      setButtonState('armed');
      armedTimer = setTimeout(() => {
        disarm();
      }, RISK_CONSTANTS.ARMED_DWELL_TIMEOUT_MS);
      return;
    }

    // Second click while ARMED: atomically claim and dispatch
    if (buttonState() === 'inflight') return;

    if (armedTimer) clearTimeout(armedTimer);
    setButtonState('inflight');

    const clientOrderId = `order_${props.symbol}_${action}_${Date.now()}`;
    try {
      const res = await props.onTradeClick(d, action, clientOrderId);
      const isSuccess = res && typeof res === 'object' && 'success' in res ? (res as any).success : true;
      setButtonState(isSuccess ? 'flash_success' : 'flash_error');
    } catch {
      setButtonState('flash_error');
    } finally {
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = setTimeout(() => {
        setButtonState('resting');
        setArmedAction(null);
      }, 450);
    }
  };

  return (
    <Show when={item()}>
      {(data) => (
        <tr
          class="symbol-row"
          classList={{
            'is-pinned': isPinned(),
            'is-dragging': isDragging(),
            'drag-over': isDragOver(),
          }}
          draggable={true}
          onMouseEnter={() => setIsRowHovered(true)}
          onMouseLeave={() => setIsRowHovered(false)}
          onDblClick={() => props.onOpenDeepDive(data())}
          title="Double-click row to open Deep Dive calculation"
          onDragStart={(e) => {
            marketStore.setDraggedSymbol(props.symbol);
            e.dataTransfer?.setData('text/plain', props.symbol);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (marketStore.draggedSymbol() !== props.symbol) {
              marketStore.setDragOverSymbol(props.symbol);
            }
          }}
          onDragLeave={() => {
            if (marketStore.dragOverSymbol() === props.symbol) {
              marketStore.setDragOverSymbol(null);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            marketStore.handleDrop(props.symbol);
          }}
          onDragEnd={() => {
            marketStore.setDraggedSymbol(null);
            marketStore.setDragOverSymbol(null);
          }}
        >
          {/* Col 1: Symbol (with drag handle, pin) */}
          <td class="col-symbol-cell">
            <div class="symbol-cell">
              <span class="drag-handle" title="Drag to reorder symbol">
                ⠿
              </span>
              <button
                class="pin-btn"
                classList={{ pinned: isPinned() }}
                onClick={(e) => {
                  e.stopPropagation();
                  preferencesStore.togglePin(props.symbol);
                }}
                title={isPinned() ? 'Pinned to top (Click to unpin)' : 'Pin symbol to top'}
              >
                📌
              </button>
              <span class="symbol-name">{data().spec.symbol}</span>
            </div>
          </td>

          {/* Col 2: Trend (60s) Micro-Sparkline Ribbon */}
          <td class="text-center trend-cell">
            <MicroSparkline
              symbol={props.symbol}
              price={data().spec.bid}
              isPinned={isPinned()}
              isHovered={isRowHovered()}
              width={64}
              height={20}
            />
          </td>

          {/* Col 3: Market Price & Spread */}
          <td class="text-right">
            <div class="price-quotes-cluster">
              <div class="quotes-stacked">
                <span
                  class="price-bid tabular-num"
                  classList={{
                    'tick-flash-up': tickDirection() === 'up',
                    'tick-flash-down': tickDirection() === 'down',
                  }}
                >
                  {data().spec.bid_display}
                </span>
                <span class="price-ask tabular-num">{data().spec.ask_display}</span>
              </div>
              <span
                class="spread-pill-mini"
                classList={{
                  'spread-pill-surge': isSpreadSurge(),
                }}
                title={
                  isSpreadSurge()
                    ? `⚠️ Spread Surge: ${data().spec.spread_display}p exceeds 2.0x median (${data().spec.median_spread_pips?.toFixed(1)}p)`
                    : undefined
                }
              >
                {isSpreadSurge() ? '⚠️ ' : ''}{data().spec.spread_display}p
              </span>
            </div>
          </td>

          {/* Col 3: 14D ADR & Session Exhaustion Micro-Gauge */}
          <td class="text-right">
            <div
              class="adr-cell-wrapper"
              onMouseEnter={() => setIsAdrHovered(true)}
              onMouseLeave={() => setIsAdrHovered(false)}
            >
              <div class="adr-cell-stacked">
                <div class="adr-top-row">
                  <span class="adr-val tabular-num">{data().spec.adr_display}p</span>
                  <Show when={data().spec.adr_used_pct !== undefined}>
                    <span
                      class="adr-pct-badge tabular-num"
                      classList={{
                        'adr-warning': (data().spec.adr_used_pct || 0) >= 90,
                        'adr-caution': (data().spec.adr_used_pct || 0) >= 70 && (data().spec.adr_used_pct || 0) < 90,
                      }}
                    >
                      {(data().spec.adr_used_pct || 0) >= 90 ? '⚠️ ' : ''}{Math.round(data().spec.adr_used_pct || 0)}%
                    </span>
                  </Show>
                </div>
                <Show when={data().spec.adr_used_pct !== undefined}>
                  <div class="adr-gauge-bar">
                    <div
                      class="adr-gauge-fill"
                      classList={{
                        'gauge-danger': (data().spec.adr_used_pct || 0) >= 90,
                        'gauge-caution': (data().spec.adr_used_pct || 0) >= 70 && (data().spec.adr_used_pct || 0) < 90,
                      }}
                      style={{ width: `${Math.min(100, Math.max(2, data().spec.adr_used_pct || 0))}%` }}
                    />
                  </div>
                </Show>
              </div>

              {/* Rich Institutional ADR & Session Range Micro-Popover */}
              <Show when={isAdrHovered()}>
                <div class="adr-telemetry-popover">
                  <div class="adr-popover-header">
                    <div class="adr-popover-title-group">
                      <span class="adr-popover-icon">📐</span>
                      <span class="adr-popover-title">SESSION RANGE & ADR</span>
                    </div>
                    <span
                      class="adr-popover-status-badge"
                      classList={{
                        'status-exhausted': (data().spec.adr_used_pct || 0) >= 90,
                        'status-caution': (data().spec.adr_used_pct || 0) >= 70 && (data().spec.adr_used_pct || 0) < 90,
                        'status-normal': (data().spec.adr_used_pct || 0) < 70,
                      }}
                    >
                      {(data().spec.adr_used_pct || 0) >= 90
                        ? '⚠️ EXHAUSTED'
                        : (data().spec.adr_used_pct || 0) >= 70
                        ? 'HIGH EXPANSION'
                        : 'NORMAL RANGE'}
                    </span>
                  </div>

                  {/* Visual Session Range vs ADR Progress Bar */}
                  <div class="adr-popover-progress-box">
                    <div class="adr-progress-labels">
                      <span class="adr-progress-left font-mono">
                        Session: <strong>{data().spec.today_range_pips ?? data().spec.adr_display}p</strong>
                      </span>
                      <span class="adr-progress-right font-mono">
                        14D ADR: <strong>{data().spec.adr_display}p</strong>
                      </span>
                    </div>
                    <div class="adr-popover-track">
                      <div
                        class="adr-popover-fill"
                        classList={{
                          'fill-danger': (data().spec.adr_used_pct || 0) >= 90,
                          'fill-caution': (data().spec.adr_used_pct || 0) >= 70 && (data().spec.adr_used_pct || 0) < 90,
                          'fill-normal': (data().spec.adr_used_pct || 0) < 70,
                        }}
                        style={{
                          width: `${Math.min(100, Math.max(2, data().spec.adr_used_pct || 0))}%`,
                        }}
                      />
                    </div>
                  </div>

                  {/* 2x2 Telemetry Quant Grid */}
                  <div class="adr-popover-grid">
                    <div class="adr-popover-item">
                      <span class="adr-item-label">Used of Daily ADR</span>
                      <span
                        class="adr-item-val font-mono font-bold"
                        classList={{
                          'text-loss': (data().spec.adr_used_pct || 0) >= 90,
                          'text-warning': (data().spec.adr_used_pct || 0) >= 70 && (data().spec.adr_used_pct || 0) < 90,
                          'text-profit': (data().spec.adr_used_pct || 0) < 70,
                        }}
                      >
                        {data().spec.adr_used_pct !== undefined ? `${Math.round(data().spec.adr_used_pct!)}%` : '—'}
                      </span>
                    </div>

                    <div class="adr-popover-item">
                      <span class="adr-item-label">14D Volatility (ATR)</span>
                      <span class="adr-item-val font-mono">{data().spec.atr_display ?? data().spec.adr_display}p</span>
                    </div>

                    <div class="adr-popover-item">
                      <span class="adr-item-label">Remaining Room ↑ Long</span>
                      <span
                        class="adr-item-val font-mono"
                        classList={{
                          'text-profit': (data().spec.room_up_pips || 0) > 0,
                          'text-neutral': (data().spec.room_up_pips || 0) <= 0,
                        }}
                      >
                        {data().spec.room_up_pips !== undefined
                          ? `↑ +${data().spec.room_up_pips!.toFixed(1)}p`
                          : '—'}
                      </span>
                    </div>

                    <div class="adr-popover-item">
                      <span class="adr-item-label">Remaining Room ↓ Short</span>
                      <span
                        class="adr-item-val font-mono"
                        classList={{
                          'text-loss': (data().spec.room_down_pips || 0) > 0,
                          'text-neutral': (data().spec.room_down_pips || 0) <= 0,
                        }}
                      >
                        {data().spec.room_down_pips !== undefined
                          ? `↓ -${data().spec.room_down_pips!.toFixed(1)}p`
                          : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              </Show>
            </div>
          </td>

          {/* Col 4: Stop Loss (Wider 76px numeric input with Auto-Select & Custom Reset) */}
          <td class="text-center">
            <div
              class="sl-input-cell-wrapper"
              classList={{ 'is-overridden': isCustomSL() }}
            >
              <input
                id={`sl-input-${props.symbol}`}
                name={`sl_${props.symbol}`}
                aria-label={`Stop Loss for ${props.symbol} in pips`}
                type="number"
                class="sl-input tabular-num"
                classList={{ 'sl-input-custom': isCustomSL() }}
                step="1"
                min="1"
                value={localVal()}
                onFocus={(e) => {
                  setIsFocused(true);
                  e.currentTarget.select(); // Auto-select for instant 1-keystroke replacement
                }}
                onBlur={(e) => {
                  setIsFocused(false);
                  handleSlCommit(e.currentTarget.value, false);
                }}
                onInput={(e) => {
                  const raw = e.currentTarget.value;
                  setLocalVal(raw);
                  const val = parseFloat(raw);
                  if (!isNaN(val) && val > 0) {
                    handleSlCommit(raw, true);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSlCommit(e.currentTarget.value, false);
                    e.currentTarget.blur();
                  }
                }}
                title="Stop Loss in Points/Pips (Auto-selects on focus, Enter to commit)"
              />
              <Show when={isCustomSL()}>
                <button
                  type="button"
                  class="quick-sl-reset-btn"
                  aria-label="Reset Stop Loss to global preset"
                  onClick={(e) => {
                    e.stopPropagation();
                    preferencesStore.resetSymbolSL(props.symbol);
                    setLocalVal(activeSL().toString());
                  }}
                  title="Custom SL active — click to reset to global preset"
                >
                  ↺
                </button>
              </Show>
            </div>
          </td>

          {/* Col 5: Lot Size */}
          <td class="text-right">
            <div class="lot-cell-wrapper" title={`Exact calculation: ${data().calc.exact_lot_display} Lot`}>
              <span class="executable-lot-val tabular-num">{data().calc.lot_display} Lot</span>
              <Show when={isRiskDeviated()}>
                <span
                  class="risk-alert-icon"
                  title={`Risk deviation warning: Min/Max broker lot clamp caused effective risk to deviate (${effectiveRiskDisplay()})`}
                >
                  ⚠️
                </span>
              </Show>
              <Show when={isMaxRiskExceeded()}>
                <span
                  class="risk-ceiling-icon"
                  title={`Risk alert: Effective risk exceeds configured ceiling (${preferencesStore.maxRiskCeilingPct().toFixed(1)}%)`}
                >
                  🛑
                </span>
              </Show>
            </div>
          </td>

          {/* Col 6: Effective Risk & Required Margin (Stacked) */}
          <td class="text-right">
            <div
              class="risk-stacked-cell"
              onClick={() => props.onOpenDeepDive(data())}
              title={riskCellTooltip()}
            >
              <div class="risk-main-row">
                <span
                  class="risk-amount-tag tabular-num"
                  classList={{
                    'risk-elevated': isRiskDeviated() || isMaxRiskExceeded(),
                  }}
                >
                  {effectiveRiskDisplay()}
                </span>
              </div>
              <div class="margin-sub-row">
                <span class="margin-sub-text">{marginDisplay()}</span>
              </div>
            </div>
          </td>

          {/* Col 7: 5-State Execution Buttons with Dual-Arm Safety Gate */}
          <td class="text-center">
            <div class={`trade-btn-group trade-btn-group-${props.symbol}`}>
              <button
                type="button"
                class="btn-trade btn-sell"
                classList={{
                  'btn-armed': armedAction() === 'SELL' && buttonState() === 'armed',
                  'btn-inflight': armedAction() === 'SELL' && buttonState() === 'inflight',
                  'btn-flash-success': armedAction() === 'SELL' && buttonState() === 'flash_success',
                  'btn-flash-error': armedAction() === 'SELL' && buttonState() === 'flash_error',
                  'btn-dimmed': armedAction() === 'BUY',
                  'btn-disabled-margin': isMarginInsufficient(),
                }}
                disabled={isMarginInsufficient() || (armedAction() === 'SELL' && buttonState() === 'inflight')}
                onClick={(e) => handleExecute(e, 'SELL')}
                title={
                  isMarginInsufficient()
                    ? `Insufficient Margin: Required $${data().calc.required_margin_display} exceeds 95% of Free Margin`
                    : armedAction() === 'SELL'
                    ? `Click again to CONFIRM SELL ${data().calc.lot_display} Lot ${data().spec.symbol}`
                    : `Arm SELL ${data().calc.lot_display} Lot ${data().spec.symbol} (2-Step Safety)`
                }
              >
                <Show when={armedAction() === 'SELL' && buttonState() === 'armed'}>
                  <span class="btn-trade-label">SELL</span>
                  <div class="btn-armed-dwell-line" />
                </Show>
                <Show when={armedAction() === 'SELL' && buttonState() === 'inflight'}>
                  <span class="btn-trade-spinner" />
                </Show>
                <Show when={armedAction() === 'SELL' && buttonState() === 'flash_success'}>
                  <span class="btn-trade-glyph">✓</span>
                </Show>
                <Show when={armedAction() === 'SELL' && buttonState() === 'flash_error'}>
                  <span class="btn-trade-glyph">✕</span>
                </Show>
                <Show when={armedAction() !== 'SELL' || buttonState() === 'resting'}>
                  <span class="btn-trade-label">SELL</span>
                </Show>
              </button>

              <button
                type="button"
                class="btn-trade btn-buy"
                classList={{
                  'btn-armed': armedAction() === 'BUY' && buttonState() === 'armed',
                  'btn-inflight': armedAction() === 'BUY' && buttonState() === 'inflight',
                  'btn-flash-success': armedAction() === 'BUY' && buttonState() === 'flash_success',
                  'btn-flash-error': armedAction() === 'BUY' && buttonState() === 'flash_error',
                  'btn-dimmed': armedAction() === 'SELL',
                  'btn-disabled-margin': isMarginInsufficient(),
                }}
                disabled={isMarginInsufficient() || (armedAction() === 'BUY' && buttonState() === 'inflight')}
                onClick={(e) => handleExecute(e, 'BUY')}
                title={
                  isMarginInsufficient()
                    ? `Insufficient Margin: Required $${data().calc.required_margin_display} exceeds 95% of Free Margin`
                    : armedAction() === 'BUY'
                    ? `Click again to CONFIRM BUY ${data().calc.lot_display} Lot ${data().spec.symbol}`
                    : `Arm BUY ${data().calc.lot_display} Lot ${data().spec.symbol} (2-Step Safety)`
                }
              >
                <Show when={armedAction() === 'BUY' && buttonState() === 'armed'}>
                  <span class="btn-trade-label">BUY</span>
                  <div class="btn-armed-dwell-line" />
                </Show>
                <Show when={armedAction() === 'BUY' && buttonState() === 'inflight'}>
                  <span class="btn-trade-spinner" />
                </Show>
                <Show when={armedAction() === 'BUY' && buttonState() === 'flash_success'}>
                  <span class="btn-trade-glyph">✓</span>
                </Show>
                <Show when={armedAction() === 'BUY' && buttonState() === 'flash_error'}>
                  <span class="btn-trade-glyph">✕</span>
                </Show>
                <Show when={armedAction() !== 'BUY' || buttonState() === 'resting'}>
                  <span class="btn-trade-label">BUY</span>
                </Show>
              </button>
            </div>
          </td>
        </tr>
      )}
    </Show>
  );
};
