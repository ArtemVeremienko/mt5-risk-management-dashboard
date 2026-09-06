import { Component, createSignal, createMemo, createEffect, onCleanup, untrack, Show } from 'solid-js';
import { OpenPosition } from '../../types';
import { api } from '../../services/api';
import { toastStore } from '../../stores/toastStore';
import { marketStore } from '../../stores/marketStore';
import { preferencesStore } from '../../stores/preferencesStore';
import { positionsStore } from '../../stores/positionsStore';
import { getAssetStepRule, stepPrice } from '../../utils/stepperEngine';
import { autofocus } from '../../directives/autofocus';
import {
  slPriceToPipsCash,
  slPipsToPriceCash,
  slCashToPricePips,
  slRToPricePipsCash,
  tpPriceToPipsCash,
  tpPipsToPriceCash,
  tpCashToPricePips,
  tpRToPricePipsCash,
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
  const stepRule = createMemo(() => {
    const p = props.position;
    return getAssetStepRule(p.symbol, p.digits, p.pip_size, p.step_rule);
  });

  const pipValPerLot = createMemo(() => {
    const calcResult = marketStore.getCalculatedResult(props.position.symbol);
    return calcResult?.calc?.pip_value_per_lot || 10.0;
  });

  // Helper to compute R from cash
  const calcRFromCash = (cashVal: string | number) => {
    const val = typeof cashVal === 'string' ? parseFloat(cashVal) : cashVal;
    if (isNaN(val) || val === 0) return '';
    const oneR = positionsStore.oneRCash();
    return oneR > 0 ? (val / oneR).toFixed(2) : '';
  };

  // One-time initialization on construction (untracked to decouple from background quote/position stream)
  const initP = props.position;
  const initRule = getAssetStepRule(initP.symbol, initP.digits, initP.pip_size, initP.step_rule);
  const initPipVal = untrack(() => marketStore.getCalculatedResult(initP.symbol)?.calc?.pip_value_per_lot || 10.0);
  const initIsBuy = initP.type === 'BUY';

  const initSlRes = (initP.sl && initP.sl > 0)
    ? slPriceToPipsCash(initP.sl, initP.price_open, initIsBuy, initP.volume, initRule.pipSize, initPipVal, initP.digits)
    : null;

  const initTpRes = (initP.tp && initP.tp > 0)
    ? tpPriceToPipsCash(initP.tp, initP.price_open, initIsBuy, initP.volume, initRule.pipSize, initPipVal, initP.digits)
    : null;

  const initOneR = untrack(() => positionsStore.oneRCash());
  const initSlR = initSlRes && initOneR > 0 ? (parseFloat(initSlRes.cash) / initOneR).toFixed(2) : '';
  const initTpR = initTpRes && initOneR > 0 ? (parseFloat(initTpRes.cash) / initOneR).toFixed(2) : '';

  const [slPrice, setSlPrice] = createSignal<string>(initSlRes?.price || '');
  const [slPips, setSlPips] = createSignal<string>(initSlRes?.pips || '');
  const [slCash, setSlCash] = createSignal<string>(initSlRes?.cash || '');
  const [slR, setSlR] = createSignal<string>(initSlR);

  const [tpPrice, setTpPrice] = createSignal<string>(initTpRes?.price || '');
  const [tpPips, setTpPips] = createSignal<string>(initTpRes?.pips || '');
  const [tpCash, setTpCash] = createSignal<string>(initTpRes?.cash || '');
  const [tpR, setTpR] = createSignal<string>(initTpR);

  const [isSubmitting, setIsSubmitting] = createSignal<boolean>(false);
  const [editingSide] = createSignal<'SL' | 'TP'>(props.initialSide || 'SL');

  // SL update handlers
  const updateSlFromPrice = (val: string | number) => {
    const p = props.position;
    const res = slPriceToPipsCash(val, p.price_open, p.type === 'BUY', p.volume, stepRule().pipSize, pipValPerLot(), p.digits);
    setSlPrice(res.price);
    setSlPips(res.pips);
    setSlCash(res.cash);
    setSlR(calcRFromCash(res.cash));
  };

  const updateSlFromPips = (val: string | number) => {
    const p = props.position;
    const res = slPipsToPriceCash(val, p.price_open, p.type === 'BUY', p.volume, stepRule().pipSize, pipValPerLot(), p.digits);
    setSlPrice(res.price);
    setSlPips(res.pips);
    setSlCash(res.cash);
    setSlR(calcRFromCash(res.cash));
  };

  const updateSlFromCash = (val: string | number) => {
    const p = props.position;
    const res = slCashToPricePips(val, p.price_open, p.type === 'BUY', p.volume, stepRule().pipSize, pipValPerLot(), p.digits);
    setSlPrice(res.price);
    setSlPips(res.pips);
    setSlCash(res.cash);
    setSlR(calcRFromCash(res.cash));
  };

  const updateSlFromR = (val: string | number) => {
    const p = props.position;
    const oneR = positionsStore.oneRCash();
    const res = slRToPricePipsCash(val, p.price_open, p.type === 'BUY', p.volume, stepRule().pipSize, pipValPerLot(), p.digits, oneR);
    setSlPrice(res.price);
    setSlPips(res.pips);
    setSlCash(res.cash);
    setSlR(res.r || '');
  };

  // TP update handlers
  const updateTpFromPrice = (val: string | number) => {
    const p = props.position;
    const res = tpPriceToPipsCash(val, p.price_open, p.type === 'BUY', p.volume, stepRule().pipSize, pipValPerLot(), p.digits);
    setTpPrice(res.price);
    setTpPips(res.pips);
    setTpCash(res.cash);
    setTpR(calcRFromCash(res.cash));
  };

  const updateTpFromPips = (val: string | number) => {
    const p = props.position;
    const res = tpPipsToPriceCash(val, p.price_open, p.type === 'BUY', p.volume, stepRule().pipSize, pipValPerLot(), p.digits);
    setTpPrice(res.price);
    setTpPips(res.pips);
    setTpCash(res.cash);
    setTpR(calcRFromCash(res.cash));
  };

  const updateTpFromCash = (val: string | number) => {
    const p = props.position;
    const res = tpCashToPricePips(val, p.price_open, p.type === 'BUY', p.volume, stepRule().pipSize, pipValPerLot(), p.digits);
    setTpPrice(res.price);
    setTpPips(res.pips);
    setTpCash(res.cash);
    setTpR(calcRFromCash(res.cash));
  };

  const updateTpFromR = (val: string | number) => {
    const p = props.position;
    const oneR = positionsStore.oneRCash();
    const res = tpRToPricePipsCash(val, p.price_open, p.type === 'BUY', p.volume, stepRule().pipSize, pipValPerLot(), p.digits, oneR);
    setTpPrice(res.price);
    setTpPips(res.pips);
    setTpCash(res.cash);
    setTpR(res.r || '');
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

  const stepSlRHandler = (direction: 'UP' | 'DOWN', e?: KeyboardEvent | MouseEvent) => {
    const current = slR().trim() ? Math.abs(parseFloat(slR())) : 1.0;
    let step = 0.1;
    if (e) {
      if (e.shiftKey) step = 0.5;
      else if (e.altKey) step = 0.01;
    }
    const next = direction === 'UP' ? current + step : Math.max(0.05, current - step);
    updateSlFromR(-next);
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

  const stepTpRHandler = (direction: 'UP' | 'DOWN', e?: KeyboardEvent | MouseEvent) => {
    const current = tpR().trim() ? Math.abs(parseFloat(tpR())) : 1.5;
    let step = 0.1;
    if (e) {
      if (e.shiftKey) step = 0.5;
      else if (e.altKey) step = 0.01;
    }
    const next = direction === 'UP' ? current + step : Math.max(0.05, current - step);
    updateTpFromR(next);
  };

  // Preset Handlers
  const applyBreakEvenSnap = () => {
    const calcResult = marketStore.getCalculatedResult(props.position.symbol);
    const spreadPips = calcResult?.spec?.spread_pips || 0.5;
    const bufferPips = spreadPips + 0.5;
    updateSlFromPips(bufferPips);
  };

  const applySlRPreset = (rMultiple: number) => {
    updateSlFromR(-Math.abs(rMultiple));
  };

  const applyTpRPreset = (rMultiple: number) => {
    updateTpFromR(Math.abs(rMultiple));
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

            {/* Tier 3: Risk (R) or Cash Loss $ */}
            <div class="sltp-tier-row">
              <span class="sltp-tier-label">
                {preferencesStore.pnlDisplayMode() === 'r_multiple' ? 'Risk (R)' : 'Loss $'}
              </span>
              <div class="sltp-stepper-box">
                <button
                  type="button"
                  class="btn-stepper-touch"
                  onClick={(e) => {
                    if (preferencesStore.pnlDisplayMode() === 'r_multiple') {
                      stepSlRHandler('DOWN', e);
                    } else {
                      stepSlCashHandler('DOWN', e);
                    }
                  }}
                  title={
                    preferencesStore.pnlDisplayMode() === 'r_multiple'
                      ? '-0.10 R (Shift: -0.50 R, Alt: -0.01 R)'
                      : '-$10.00 (Shift: -$50, Alt: -$1)'
                  }
                  tabindex="-1"
                >
                  −
                </button>
                <Show
                  when={preferencesStore.pnlDisplayMode() === 'r_multiple'}
                  fallback={
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
                  }
                >
                  <input
                    use:autofocus={editingSide() === 'SL' && preferencesStore.defaultSltpFocusField() === 'cash'}
                    type="number"
                    class="sltp-input-main text-risk tabular-num"
                    placeholder="-1.00 R"
                    step="0.1"
                    value={slR()}
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={() => {
                      const num = parseFloat(slR());
                      if (!isNaN(num) && num !== 0) setSlR((-Math.abs(num)).toFixed(2));
                    }}
                    onInput={(e) => updateSlFromR(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        stepSlRHandler('UP', e);
                      } else if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        stepSlRHandler('DOWN', e);
                      }
                    }}
                  />
                </Show>
                <button
                  type="button"
                  class="btn-stepper-touch"
                  onClick={(e) => {
                    if (preferencesStore.pnlDisplayMode() === 'r_multiple') {
                      stepSlRHandler('UP', e);
                    } else {
                      stepSlCashHandler('UP', e);
                    }
                  }}
                  title={
                    preferencesStore.pnlDisplayMode() === 'r_multiple'
                      ? '+0.10 R (Shift: +0.50 R, Alt: +0.01 R)'
                      : '+$10.00 (Shift: +$50, Alt: +$1)'
                  }
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
                onClick={() => applySlRPreset(0.5)}
                title="Snap SL to -0.5 R Initial Risk"
                tabindex="-1"
              >
                🎯 0.5 R
              </button>
              <button
                type="button"
                class="btn-preset-chip"
                onClick={() => applySlRPreset(1.0)}
                title="Snap SL to exactly -1 R Initial Risk"
                tabindex="-1"
              >
                🎯 1 R
              </button>
              <button
                type="button"
                class="btn-preset-chip"
                onClick={applyBreakEvenSnap}
                title="Snap SL to Entry Price + Spread Buffer"
                tabindex="-1"
              >
                🛡️ Entry / BE
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

            {/* Tier 3: Profit (R) or Cash Gain $ */}
            <div class="sltp-tier-row">
              <span class="sltp-tier-label">
                {preferencesStore.pnlDisplayMode() === 'r_multiple' ? 'Profit (R)' : 'Profit $'}
              </span>
              <div class="sltp-stepper-box">
                <button
                  type="button"
                  class="btn-stepper-touch"
                  onClick={(e) => {
                    if (preferencesStore.pnlDisplayMode() === 'r_multiple') {
                      stepTpRHandler('DOWN', e);
                    } else {
                      stepTpCashHandler('DOWN', e);
                    }
                  }}
                  title={
                    preferencesStore.pnlDisplayMode() === 'r_multiple'
                      ? '-0.10 R (Shift: -0.50 R, Alt: -0.01 R)'
                      : '-$10.00 (Shift: -$50, Alt: -$1)'
                  }
                  tabindex="-1"
                >
                  −
                </button>
                <Show
                  when={preferencesStore.pnlDisplayMode() === 'r_multiple'}
                  fallback={
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
                  }
                >
                  <input
                    use:autofocus={editingSide() === 'TP' && preferencesStore.defaultSltpFocusField() === 'cash'}
                    type="number"
                    class="sltp-input-main text-profit tabular-num"
                    placeholder="+1.50 R"
                    step="0.1"
                    value={tpR()}
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={() => {
                      const num = parseFloat(tpR());
                      if (!isNaN(num) && num !== 0) setTpR((+Math.abs(num)).toFixed(2));
                    }}
                    onInput={(e) => updateTpFromR(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        stepTpRHandler('UP', e);
                      } else if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        stepTpRHandler('DOWN', e);
                      }
                    }}
                  />
                </Show>
                <button
                  type="button"
                  class="btn-stepper-touch"
                  onClick={(e) => {
                    if (preferencesStore.pnlDisplayMode() === 'r_multiple') {
                      stepTpRHandler('UP', e);
                    } else {
                      stepTpCashHandler('UP', e);
                    }
                  }}
                  title={
                    preferencesStore.pnlDisplayMode() === 'r_multiple'
                      ? '+0.10 R (Shift: +0.50 R, Alt: +0.01 R)'
                      : '+$10.00 (Shift: +$50, Alt: +$1)'
                  }
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
                onClick={() => applyTpRPreset(1.0)}
                title="Set TP to +1 R Target Profit"
                tabindex="-1"
              >
                🎯 1 R
              </button>
              <button
                type="button"
                class="btn-preset-chip"
                onClick={() => applyTpRPreset(1.5)}
                title="Set TP to +1.5 R Target Profit"
                tabindex="-1"
              >
                🎯 1.5 R
              </button>
              <button
                type="button"
                class="btn-preset-chip"
                onClick={() => applyTpRPreset(2.0)}
                title="Set TP to +2 R Target Profit"
                tabindex="-1"
              >
                🎯 2 R
              </button>
              <button
                type="button"
                class="btn-preset-chip"
                onClick={() => applyTpRPreset(3.0)}
                title="Set TP to +3 R Target Profit"
                tabindex="-1"
              >
                🎯 3 R
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
