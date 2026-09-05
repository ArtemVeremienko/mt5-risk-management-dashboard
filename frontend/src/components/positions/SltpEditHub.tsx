import { Component, createSignal, createMemo, createEffect, onCleanup } from 'solid-js';
import { OpenPosition } from '../../types';
import { api } from '../../services/api';
import { toastStore } from '../../stores/toastStore';
import { marketStore } from '../../stores/marketStore';
import { preferencesStore } from '../../stores/preferencesStore';
import { getAssetStepRule, stepPrice } from '../../utils/stepperEngine';
import { autofocus } from '../../directives/autofocus';
import {
  slPriceToPipsCash,
  slPipsToPriceCash,
  slCashToPricePips,
  tpPriceToPipsCash,
  tpPipsToPriceCash,
  tpCashToPricePips,
} from '../../utils/positionMath';

// Reference directive for compiler JSX recognition
false && autofocus;

interface SltpEditHubProps {
  position: OpenPosition;
  initialSide?: 'SL' | 'TP';
  onClose: () => void;
  onSuccess?: () => void;
}

export const SltpEditHub: Component<SltpEditHubProps> = (props) => {
  let hubRef: HTMLDivElement | undefined;

  const [slPrice, setSlPrice] = createSignal<string>('');
  const [slPips, setSlPips] = createSignal<string>('');
  const [slCash, setSlCash] = createSignal<string>('');

  const [tpPrice, setTpPrice] = createSignal<string>('');
  const [tpPips, setTpPips] = createSignal<string>('');
  const [tpCash, setTpCash] = createSignal<string>('');

  const [isSubmitting, setIsSubmitting] = createSignal<boolean>(false);
  const [editingSide] = createSignal<'SL' | 'TP'>(props.initialSide || 'SL');

  const stepRule = createMemo(() => {
    const p = props.position;
    return getAssetStepRule(p.symbol, p.digits, p.pip_size, p.step_rule);
  });

  const pipValPerLot = createMemo(() => {
    const calcResult = marketStore.getCalculatedResult(props.position.symbol);
    return calcResult?.calc?.pip_value_per_lot || 10.0;
  });

  // Initialize signals from current position values
  createEffect(() => {
    const p = props.position;
    const rule = stepRule();
    const pipVal = pipValPerLot();
    const isBuy = p.type === 'BUY';

    if (p.sl && p.sl > 0) {
      const res = slPriceToPipsCash(p.sl, p.price_open, isBuy, p.volume, rule.pipSize, pipVal, p.digits);
      setSlPrice(res.price);
      setSlPips(res.pips);
      setSlCash(res.cash);
    } else {
      setSlPrice('');
      setSlPips('');
      setSlCash('');
    }

    if (p.tp && p.tp > 0) {
      const res = tpPriceToPipsCash(p.tp, p.price_open, isBuy, p.volume, rule.pipSize, pipVal, p.digits);
      setTpPrice(res.price);
      setTpPips(res.pips);
      setTpCash(res.cash);
    } else {
      setTpPrice('');
      setTpPips('');
      setTpCash('');
    }
  });

  // SL update handlers
  const updateSlFromPrice = (val: string | number) => {
    const p = props.position;
    const res = slPriceToPipsCash(val, p.price_open, p.type === 'BUY', p.volume, stepRule().pipSize, pipValPerLot(), p.digits);
    setSlPrice(res.price);
    setSlPips(res.pips);
    setSlCash(res.cash);
  };

  const updateSlFromPips = (val: string | number) => {
    const p = props.position;
    const res = slPipsToPriceCash(val, p.price_open, p.type === 'BUY', p.volume, stepRule().pipSize, pipValPerLot(), p.digits);
    setSlPrice(res.price);
    setSlPips(res.pips);
    setSlCash(res.cash);
  };

  const updateSlFromCash = (val: string | number) => {
    const p = props.position;
    const res = slCashToPricePips(val, p.price_open, p.type === 'BUY', p.volume, stepRule().pipSize, pipValPerLot(), p.digits);
    setSlPrice(res.price);
    setSlPips(res.pips);
    setSlCash(res.cash);
  };

  // TP update handlers
  const updateTpFromPrice = (val: string | number) => {
    const p = props.position;
    const res = tpPriceToPipsCash(val, p.price_open, p.type === 'BUY', p.volume, stepRule().pipSize, pipValPerLot(), p.digits);
    setTpPrice(res.price);
    setTpPips(res.pips);
    setTpCash(res.cash);
  };

  const updateTpFromPips = (val: string | number) => {
    const p = props.position;
    const res = tpPipsToPriceCash(val, p.price_open, p.type === 'BUY', p.volume, stepRule().pipSize, pipValPerLot(), p.digits);
    setTpPrice(res.price);
    setTpPips(res.pips);
    setTpCash(res.cash);
  };

  const updateTpFromCash = (val: string | number) => {
    const p = props.position;
    const res = tpCashToPricePips(val, p.price_open, p.type === 'BUY', p.volume, stepRule().pipSize, pipValPerLot(), p.digits);
    setTpPrice(res.price);
    setTpPips(res.pips);
    setTpCash(res.cash);
  };

  // Steppers for SL
  const stepSlPriceHandler = (direction: 'UP' | 'DOWN', e?: KeyboardEvent | MouseEvent) => {
    const p = props.position;
    const rule = stepRule();
    const currentVal = slPrice().trim() ? parseFloat(slPrice()) : (p.sl || p.price_open);
    const newVal = stepPrice(currentVal, direction, rule, e);
    updateSlFromPrice(newVal);
  };

  const stepSlPipsHandler = (direction: 'UP' | 'DOWN', e?: KeyboardEvent | MouseEvent) => {
    const current = slPips().trim() ? parseFloat(slPips()) : 20.0;
    let step = 1.0;
    if (e) {
      if (e.shiftKey) step = 10.0;
      else if (e.altKey) step = 0.1;
    }
    const next = direction === 'UP' ? current + step : Math.max(0.1, current - step);
    updateSlFromPips(next);
  };

  const stepSlCashHandler = (direction: 'UP' | 'DOWN', e?: KeyboardEvent | MouseEvent) => {
    const current = slCash().trim() ? Math.abs(parseFloat(slCash())) : 50.0;
    let step = 10.0;
    if (e) {
      if (e.shiftKey) step = 50.0;
      else if (e.altKey) step = 1.0;
    }
    const next = direction === 'UP' ? current + step : Math.max(1.0, current - step);
    updateSlFromCash(-next);
  };

  // Steppers for TP
  const stepTpPriceHandler = (direction: 'UP' | 'DOWN', e?: KeyboardEvent | MouseEvent) => {
    const p = props.position;
    const rule = stepRule();
    const currentVal = tpPrice().trim() ? parseFloat(tpPrice()) : (p.tp || p.price_open);
    const newVal = stepPrice(currentVal, direction, rule, e);
    updateTpFromPrice(newVal);
  };

  const stepTpPipsHandler = (direction: 'UP' | 'DOWN', e?: KeyboardEvent | MouseEvent) => {
    const current = tpPips().trim() ? parseFloat(tpPips()) : 30.0;
    let step = 1.0;
    if (e) {
      if (e.shiftKey) step = 10.0;
      else if (e.altKey) step = 0.1;
    }
    const next = direction === 'UP' ? current + step : Math.max(0.1, current - step);
    updateTpFromPips(next);
  };

  const stepTpCashHandler = (direction: 'UP' | 'DOWN', e?: KeyboardEvent | MouseEvent) => {
    const current = tpCash().trim() ? Math.abs(parseFloat(tpCash())) : 100.0;
    let step = 10.0;
    if (e) {
      if (e.shiftKey) step = 50.0;
      else if (e.altKey) step = 1.0;
    }
    const next = direction === 'UP' ? current + step : Math.max(1.0, current - step);
    updateTpFromCash(next);
  };

  // Preset Handlers
  const applyBreakEvenSnap = () => {
    const calcResult = marketStore.getCalculatedResult(props.position.symbol);
    const spreadPips = calcResult?.spec?.spread_pips || 0.5;
    const bufferPips = spreadPips + 0.5;
    updateSlFromPips(bufferPips);
  };

  const applyAdrSlSnap = (fraction: number) => {
    const calcResult = marketStore.getCalculatedResult(props.position.symbol);
    const adrPips = calcResult?.spec?.adr_14_pips || 0;
    const slDistPips = adrPips > 0 ? adrPips * fraction : 15.0;
    updateSlFromPips(slDistPips);
  };

  const applyRrSnap = (ratio: number) => {
    const currentSlPip = slPips().trim() ? parseFloat(slPips()) : 15.0;
    const tpDist = currentSlPip * ratio;
    updateTpFromPips(tpDist);
  };

  // Save changes via API
  const handleSave = async () => {
    if (isSubmitting()) return;
    try {
      setIsSubmitting(true);
      const slNum = slPrice().trim() ? parseFloat(slPrice()) : 0;
      const tpNum = tpPrice().trim() ? parseFloat(tpPrice()) : 0;
      const res = await api.modifyPosition(props.position.ticket, slNum, tpNum);
      if (res.success) {
        toastStore.addToast('SL/TP Updated', res.message, 'success');
        props.onSuccess?.();
        props.onClose();
      } else {
        toastStore.addToast('Modification Failed', res.message, 'error');
      }
    } catch (e: any) {
      toastStore.addToast('Error', e.message || 'Failed to modify SL/TP', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Keyboard Shortcuts (Esc, Enter) and Click Outside
  createEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        props.onClose();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        handleSave();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (hubRef && !hubRef.contains(e.target as Node)) {
        props.onClose();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown, true);
    const timer = setTimeout(() => {
      window.addEventListener('mousedown', handleClickOutside);
    }, 50);

    onCleanup(() => {
      window.removeEventListener('keydown', handleGlobalKeyDown, true);
      window.removeEventListener('mousedown', handleClickOutside);
      clearTimeout(timer);
    });
  });

  return (
    <div
      class="sltp-edit-hub"
      ref={hubRef}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div class="sltp-hub-header">
        <span class="sltp-hub-title">
          Modify SL/TP · <strong>{props.position.symbol}</strong> (#{props.position.ticket})
        </span>
        <button
          type="button"
          class="btn-sltp-close-icon"
          onClick={props.onClose}
          title="Close (Esc)"
          tabindex="-1"
        >
          ✕
        </button>
      </div>

      {/* CSS Grid Body: 2 Columns (SL and TP) */}
      <div class="sltp-hub-grid">
        {/* Left Column: Stop Loss Stacked Tier */}
        <div class="sltp-hub-column sl-column">
          <div class="sltp-column-header">
            <label class="sltp-field-label sl-label">Stop Loss</label>
            <span class="sltp-sub-hint">Risk Ceiling</span>
          </div>

          <div class="sltp-tier-stack">
            {/* Tier 1: Price */}
            <div class="sltp-tier-row">
              <span class="sltp-tier-label">Price</span>
              <div class="sltp-stepper-box">
                <button
                  type="button"
                  class="btn-stepper-touch"
                  onClick={(e) => stepSlPriceHandler('DOWN', e)}
                  title={`-1 ${stepRule().unitLabel} (Shift: -10, Alt: -0.1)`}
                  tabindex="-1"
                >
                  −
                </button>
                <input
                  use:autofocus={editingSide() === 'SL' && preferencesStore.defaultSltpFocusField() === 'price'}
                  type="number"
                  class="sltp-input-main tabular-num"
                  placeholder="SL Price"
                  min="0"
                  step={stepRule().normalStep}
                  value={slPrice()}
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={() => {
                    const num = parseFloat(slPrice());
                    if (!isNaN(num) && num > 0) setSlPrice(num.toFixed(props.position.digits));
                  }}
                  onInput={(e) => updateSlFromPrice(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      stepSlPriceHandler('UP', e);
                    } else if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      stepSlPriceHandler('DOWN', e);
                    }
                  }}
                />
                <button
                  type="button"
                  class="btn-stepper-touch"
                  onClick={(e) => stepSlPriceHandler('UP', e)}
                  title={`+1 ${stepRule().unitLabel} (Shift: +10, Alt: +0.1)`}
                  tabindex="-1"
                >
                  +
                </button>
              </div>
            </div>

            {/* Tier 2: Pips */}
            <div class="sltp-tier-row">
              <span class="sltp-tier-label">Pips</span>
              <div class="sltp-stepper-box">
                <button
                  type="button"
                  class="btn-stepper-touch"
                  onClick={(e) => stepSlPipsHandler('DOWN', e)}
                  title="-1.0 pip (Shift: -10, Alt: -0.1)"
                  tabindex="-1"
                >
                  −
                </button>
                <input
                  use:autofocus={editingSide() === 'SL' && preferencesStore.defaultSltpFocusField() === 'pips'}
                  type="number"
                  class="sltp-input-main tabular-num"
                  placeholder="Pips"
                  min="0"
                  step="0.1"
                  value={slPips()}
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={() => {
                    const num = parseFloat(slPips());
                    if (!isNaN(num) && num > 0) setSlPips(num.toFixed(1));
                  }}
                  onInput={(e) => updateSlFromPips(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      stepSlPipsHandler('UP', e);
                    } else if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      stepSlPipsHandler('DOWN', e);
                    }
                  }}
                />
                <button
                  type="button"
                  class="btn-stepper-touch"
                  onClick={(e) => stepSlPipsHandler('UP', e)}
                  title="+1.0 pip (Shift: +10, Alt: +0.1)"
                  tabindex="-1"
                >
                  +
                </button>
              </div>
            </div>

            {/* Tier 3: Cash Loss $ */}
            <div class="sltp-tier-row">
              <span class="sltp-tier-label">Loss $</span>
              <div class="sltp-stepper-box">
                <button
                  type="button"
                  class="btn-stepper-touch"
                  onClick={(e) => stepSlCashHandler('DOWN', e)}
                  title="-$10.00 (Shift: -$50, Alt: -$1)"
                  tabindex="-1"
                >
                  −
                </button>
                <input
                  use:autofocus={editingSide() === 'SL' && preferencesStore.defaultSltpFocusField() === 'cash'}
                  type="number"
                  class="sltp-input-main text-risk tabular-num"
                  placeholder="-$ Loss"
                  step="1"
                  value={slCash()}
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={() => {
                    const num = parseFloat(slCash());
                    if (!isNaN(num) && num !== 0) setSlCash((-Math.abs(num)).toFixed(2));
                  }}
                  onInput={(e) => updateSlFromCash(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      stepSlCashHandler('UP', e);
                    } else if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      stepSlCashHandler('DOWN', e);
                    }
                  }}
                />
                <button
                  type="button"
                  class="btn-stepper-touch"
                  onClick={(e) => stepSlCashHandler('UP', e)}
                  title="+$10.00 (Shift: +$50, Alt: +$1)"
                  tabindex="-1"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <div class="sltp-presets-group">
            <span class="preset-group-title">SL Presets</span>
            <div class="preset-chips-row">
              <button
                type="button"
                class="btn-preset-chip"
                onClick={applyBreakEvenSnap}
                title="Snap SL to Entry Price + Spread Buffer"
                tabindex="-1"
              >
                🛡️ Entry / BE
              </button>
              <button
                type="button"
                class="btn-preset-chip"
                onClick={() => applyAdrSlSnap(0.25)}
                title="Snap SL to 1/4 ADR distance"
                tabindex="-1"
              >
                📐 1/4 ADR
              </button>
              <button
                type="button"
                class="btn-preset-chip"
                onClick={() => applyAdrSlSnap(0.5)}
                title="Snap SL to 1/2 ADR distance"
                tabindex="-1"
              >
                📐 1/2 ADR
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Take Profit Stacked Tier */}
        <div class="sltp-hub-column tp-column">
          <div class="sltp-column-header">
            <label class="sltp-field-label tp-label">Take Profit</label>
            <span class="sltp-sub-hint">Target Objective</span>
          </div>

          <div class="sltp-tier-stack">
            {/* Tier 1: Price */}
            <div class="sltp-tier-row">
              <span class="sltp-tier-label">Price</span>
              <div class="sltp-stepper-box">
                <button
                  type="button"
                  class="btn-stepper-touch"
                  onClick={(e) => stepTpPriceHandler('DOWN', e)}
                  title={`-1 ${stepRule().unitLabel} (Shift: -10, Alt: -0.1)`}
                  tabindex="-1"
                >
                  −
                </button>
                <input
                  use:autofocus={editingSide() === 'TP' && preferencesStore.defaultSltpFocusField() === 'price'}
                  type="number"
                  class="sltp-input-main tabular-num"
                  placeholder="TP Price"
                  min="0"
                  step={stepRule().normalStep}
                  value={tpPrice()}
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={() => {
                    const num = parseFloat(tpPrice());
                    if (!isNaN(num) && num > 0) setTpPrice(num.toFixed(props.position.digits));
                  }}
                  onInput={(e) => updateTpFromPrice(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      stepTpPriceHandler('UP', e);
                    } else if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      stepTpPriceHandler('DOWN', e);
                    }
                  }}
                />
                <button
                  type="button"
                  class="btn-stepper-touch"
                  onClick={(e) => stepTpPriceHandler('UP', e)}
                  title={`+1 ${stepRule().unitLabel} (Shift: +10, Alt: +0.1)`}
                  tabindex="-1"
                >
                  +
                </button>
              </div>
            </div>

            {/* Tier 2: Pips */}
            <div class="sltp-tier-row">
              <span class="sltp-tier-label">Pips</span>
              <div class="sltp-stepper-box">
                <button
                  type="button"
                  class="btn-stepper-touch"
                  onClick={(e) => stepTpPipsHandler('DOWN', e)}
                  title="-1.0 pip (Shift: -10, Alt: -0.1)"
                  tabindex="-1"
                >
                  −
                </button>
                <input
                  use:autofocus={editingSide() === 'TP' && preferencesStore.defaultSltpFocusField() === 'pips'}
                  type="number"
                  class="sltp-input-main tabular-num"
                  placeholder="Pips"
                  min="0"
                  step="0.1"
                  value={tpPips()}
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={() => {
                    const num = parseFloat(tpPips());
                    if (!isNaN(num) && num > 0) setTpPips(num.toFixed(1));
                  }}
                  onInput={(e) => updateTpFromPips(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      stepTpPipsHandler('UP', e);
                    } else if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      stepTpPipsHandler('DOWN', e);
                    }
                  }}
                />
                <button
                  type="button"
                  class="btn-stepper-touch"
                  onClick={(e) => stepTpPipsHandler('UP', e)}
                  title="+1.0 pip (Shift: +10, Alt: +0.1)"
                  tabindex="-1"
                >
                  +
                </button>
              </div>
            </div>

            {/* Tier 3: Cash Gain $ */}
            <div class="sltp-tier-row">
              <span class="sltp-tier-label">Profit $</span>
              <div class="sltp-stepper-box">
                <button
                  type="button"
                  class="btn-stepper-touch"
                  onClick={(e) => stepTpCashHandler('DOWN', e)}
                  title="-$10.00 (Shift: -$50, Alt: -$1)"
                  tabindex="-1"
                >
                  −
                </button>
                <input
                  use:autofocus={editingSide() === 'TP' && preferencesStore.defaultSltpFocusField() === 'cash'}
                  type="number"
                  class="sltp-input-main text-profit tabular-num"
                  placeholder="+$ Profit"
                  step="1"
                  value={tpCash()}
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={() => {
                    const num = parseFloat(tpCash());
                    if (!isNaN(num) && num !== 0) setTpCash((+Math.abs(num)).toFixed(2));
                  }}
                  onInput={(e) => updateTpFromCash(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      stepTpCashHandler('UP', e);
                    } else if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      stepTpCashHandler('DOWN', e);
                    }
                  }}
                />
                <button
                  type="button"
                  class="btn-stepper-touch"
                  onClick={(e) => stepTpCashHandler('UP', e)}
                  title="+$10.00 (Shift: +$50, Alt: +$1)"
                  tabindex="-1"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <div class="sltp-presets-group">
            <span class="preset-group-title">TP Presets</span>
            <div class="preset-chips-row">
              <button
                type="button"
                class="btn-preset-chip"
                onClick={() => applyRrSnap(1.5)}
                title="Set TP to 1:1.5 Risk-Reward Ratio"
                tabindex="-1"
              >
                🎯 1:1.5 RR
              </button>
              <button
                type="button"
                class="btn-preset-chip"
                onClick={() => applyRrSnap(2.0)}
                title="Set TP to 1:2 Risk-Reward Ratio"
                tabindex="-1"
              >
                🎯 1:2 RR
              </button>
              <button
                type="button"
                class="btn-preset-chip"
                onClick={() => applyRrSnap(3.0)}
                title="Set TP to 1:3 Risk-Reward Ratio"
                tabindex="-1"
              >
                🎯 1:3 RR
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Controls: Apply & Cancel */}
      <div class="sltp-hub-footer">
        <button
          type="button"
          class="btn-sltp-cancel-text"
          onClick={props.onClose}
          disabled={isSubmitting()}
          tabindex="-1"
        >
          Cancel (Esc)
        </button>
        <button
          type="button"
          class="btn-sltp-apply-main"
          onClick={handleSave}
          disabled={isSubmitting()}
        >
          {isSubmitting() ? 'Submitting...' : '💾 Apply Changes (Enter)'}
        </button>
      </div>
    </div>
  );
};
