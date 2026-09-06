import { Component, createSignal, createMemo, Show } from 'solid-js';
import { api } from '../../services/api';
import { toastStore } from '../../stores/toastStore';
import { positionsStore } from '../../stores/positionsStore';
import { marketStore } from '../../stores/marketStore';
import { preferencesStore } from '../../stores/preferencesStore';
import { formatCurrency } from '../../utils/formatters';
import { getAssetStepRule } from '../../utils/stepperEngine';
import {
  calculateBreakEvenPrice,
  calculateSlRowInfo,
  calculateTpRowInfo,
} from '../../utils/positionMath';
import { SltpEditHub } from './SltpEditHub';

interface Props {
  ticket: number;
}

export const PositionRow: Component<Props> = (props) => {
  const position = createMemo(() => positionsStore.getPosition(props.ticket));

  const [isEditing, setIsEditing] = createSignal<boolean>(false);
  const [editingSide, setEditingSide] = createSignal<'SL' | 'TP'>('SL');
  const [isSubmitting, setIsSubmitting] = createSignal<boolean>(false);

  const stepRule = createMemo(() => {
    const p = position();
    if (!p) return getAssetStepRule('EURUSD', 5);
    return getAssetStepRule(p.symbol, p.digits, p.pip_size, p.step_rule);
  });

  const pipValPerLot = createMemo(() => {
    const p = position();
    if (!p) return 10.0;
    const calcResult = marketStore.getCalculatedResult(p.symbol);
    return calcResult?.calc?.pip_value_per_lot || 10.0;
  });

  const startEditing = (side: 'SL' | 'TP') => {
    setEditingSide(side);
    setIsEditing(true);
  };

  // Memoized row telemetry displays
  const currentSlRowInfo = createMemo(() => {
    const p = position();
    if (!p) return null;
    const rule = stepRule();
    return calculateSlRowInfo(
      p.sl,
      p.price_open,
      p.type === 'BUY',
      p.volume,
      rule.pipSize,
      pipValPerLot(),
      p.digits,
      rule.unitLabel,
      positionsStore.oneRCash()
    );
  });

  const currentTpRowInfo = createMemo(() => {
    const p = position();
    if (!p) return null;
    const rule = stepRule();
    return calculateTpRowInfo(
      p.tp,
      p.price_open,
      p.type === 'BUY',
      p.volume,
      rule.pipSize,
      pipValPerLot(),
      p.digits,
      rule.unitLabel,
      positionsStore.oneRCash()
    );
  });

  const slSubTelemetry = (info: { pipText: string; dollarText: string; rText: string }) => {
    const mode = preferencesStore.pnlDisplayMode();
    if (mode === 'r_multiple') {
      return info.rText;
    }
    if (mode === 'stealth_mask') {
      return info.pipText;
    }
    return info.dollarText;
  };

  const tpSubTelemetry = (info: { pipText: string; dollarText: string; rText: string }) => {
    const mode = preferencesStore.pnlDisplayMode();
    if (mode === 'r_multiple') {
      return info.rText;
    }
    if (mode === 'stealth_mask') {
      return info.pipText;
    }
    return info.dollarText;
  };

  const handleClosePosition = async (volume?: number) => {
    const p = position();
    if (!p) return;
    try {
      setIsSubmitting(true);
      const res = await api.closePosition(p.ticket, volume);
      if (res.success) {
        toastStore.addToast(
          'Position Closed',
          res.message || `Closed #${p.ticket} ${p.symbol}`,
          'success'
        );
      } else {
        toastStore.addToast('Close Failed', res.message, 'error');
      }
    } catch (e: any) {
      toastStore.addToast('Error', e.message || 'Failed to close position', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMoveToBreakEven = async () => {
    const p = position();
    if (!p) return;
    try {
      setIsSubmitting(true);
      const rule = stepRule();
      const calcResult = marketStore.getCalculatedResult(p.symbol);
      const spreadPips = calcResult?.spec?.spread_pips || 0.5;

      const roundedBePrice = calculateBreakEvenPrice(
        p.price_open,
        p.type === 'BUY',
        spreadPips,
        rule.pipSize,
        p.digits,
        0.5
      );

      const res = await api.modifyPosition(p.ticket, roundedBePrice, p.tp);
      if (res.success) {
        toastStore.addToast(
          'Break-Even Snapped',
          `SL snapped to ${roundedBePrice} (Entry + ${(spreadPips + 0.5).toFixed(1)} ${rule.unitLabel} spread buffer) for #${p.ticket}`,
          'success'
        );
      } else {
        toastStore.addToast('Modification Failed', res.message, 'error');
      }
    } catch (e: any) {
      toastStore.addToast('Error', e.message || 'Failed to snap to break-even', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Show when={position()}>
      {(pos) => (
        <tr
          class="position-row"
          classList={{
            'is-editing': isEditing(),
          }}
        >
          {/* 1. Ticket */}
          <td class="text-left pos-cell-ticket">
            <span class="pos-ticket">#{pos().ticket}</span>
          </td>

          {/* 2. Symbol & Side */}
          <td class="text-left pos-cell-symbol">
            <div class="pos-symbol-cell">
              <strong class="pos-symbol">{pos().symbol}</strong>
              <span
                class="pos-type-badge"
                classList={{
                  'badge-buy': pos().type === 'BUY',
                  'badge-sell': pos().type === 'SELL',
                }}
              >
                {pos().type}
              </span>
              <Show when={(marketStore.getCalculatedResult(pos().symbol)?.spec?.adr_used_pct || 0) >= 90}>
                <span
                  class="adr-exhaustion-chip"
                  title={`Statistical Exhaustion Warning: ${Math.round(marketStore.getCalculatedResult(pos().symbol)?.spec?.adr_used_pct || 0)}% ADR exhausted today`}
                >
                  ⚠️ ADR Cap
                </span>
              </Show>
            </div>
          </td>

          {/* 3. Volume */}
          <td class="text-right pos-cell-volume">
            <span class="pos-volume tabular-num">{pos().volume.toFixed(2)} Lots</span>
          </td>

          {/* 4. Open Price */}
          <td class="text-right pos-cell-open">
            <span class="font-mono tabular-num">{pos().price_open.toFixed(pos().digits)}</span>
          </td>

          {/* 5. Current Price */}
          <td class="text-right pos-cell-current">
            <span class="font-mono tabular-num">{pos().price_current.toFixed(pos().digits)}</span>
          </td>

          {/* 6. Stop Loss (Dedicated Column) */}
          <td
            class="text-center pos-cell-sl"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => startEditing('SL')}
          >
            <div class="sltp-col-cell sl-col-cell">
              <Show
                when={currentSlRowInfo()}
                fallback={
                  <button type="button" class="btn-set-target-empty sl-empty-btn">
                    + Set SL
                  </button>
                }
              >
                {(info) => (
                  <div class="sltp-display-stacked">
                    <div class="sltp-price-row">
                      <span
                        class="sltp-price-val tabular-num"
                        classList={{
                          'sl-price-val': info().isRisk,
                          'sl-price-locked': info().isBeOrProfit,
                        }}
                      >
                        {info().price}
                      </span>
                      <Show when={info().isBeOrProfit}>
                        <span class="sl-shield-micro-badge" title="Break-Even / Locked Profit Active">
                          🛡️ BE
                        </span>
                      </Show>
                    </div>
                    <span
                      class="sltp-sub-telemetry tabular-num"
                      classList={{
                        'text-risk': info().isRisk,
                        'text-profit': info().isBeOrProfit,
                      }}
                      title={`Stop Loss: ${info().price} · Distance: ${info().pipText} · Risk: ${info().dollarText} (${info().rText})`}
                    >
                      {slSubTelemetry(info())}
                    </span>
                  </div>
                )}
              </Show>
              <span class="sltp-edit-affordance" title="Click to adjust Stop Loss & Take Profit">
                ✎
              </span>
            </div>
          </td>

          {/* 7. Take Profit (Dedicated Column) */}
          <td
            class="text-center pos-cell-tp"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => startEditing('TP')}
          >
            <div class="sltp-col-cell tp-col-cell">
              <Show
                when={currentTpRowInfo()}
                fallback={
                  <button type="button" class="btn-set-target-empty tp-empty-btn">
                    + Set TP
                  </button>
                }
              >
                {(info) => (
                  <div class="sltp-display-stacked">
                    <span class="sltp-price-val tp-price-val tabular-num">{info().price}</span>
                    <span
                      class="sltp-sub-telemetry tabular-num"
                      classList={{
                        'text-profit': info().isGain,
                        'text-loss': !info().isGain,
                      }}
                      title={`Take Profit: ${info().price} · Distance: ${info().pipText} · Target: ${info().dollarText} (${info().rText})`}
                    >
                      {tpSubTelemetry(info())}
                    </span>
                  </div>
                )}
              </Show>
              <span class="sltp-edit-affordance" title="Click to adjust Stop Loss & Take Profit">
                ✎
              </span>
            </div>

            {/* Contextual SL/TP Edit Popover Anchored to the Risk Columns */}
            <Show when={isEditing()}>
              <SltpEditHub
                position={pos()}
                initialSide={editingSide()}
                onClose={() => setIsEditing(false)}
              />
            </Show>
          </td>

          {/* 8. Floating P&L */}
          <td class="text-right pos-cell-pnl">
            <div class="pos-pnl-cell text-right">
              <span
                class="pos-profit tabular-num"
                classList={{
                  'text-profit': pos().profit > 0,
                  'text-loss': pos().profit < 0,
                  'text-neutral': pos().profit === 0,
                }}
              >
                {preferencesStore.pnlDisplayMode() === 'stealth_mask'
                  ? '••••••'
                  : preferencesStore.pnlDisplayMode() === 'r_multiple'
                  ? pos().r_multiple !== null
                    ? `${(pos().r_multiple || 0) > 0 ? '+' : ''}${pos().r_multiple} R`
                    : (() => {
                        const oneR = positionsStore.oneRCash();
                        const r = oneR > 0 ? pos().profit / oneR : 0;
                        return `${r > 0 ? '+' : ''}${r.toFixed(2)} R`;
                      })()
                  : pos().profit > 0
                  ? `+${formatCurrency(pos().profit)}`
                  : formatCurrency(pos().profit)}
              </span>
              <span class="pos-pips-sub tabular-num">
                {preferencesStore.pnlDisplayMode() === 'stealth_mask'
                  ? '(•••• p)'
                  : `(${pos().pnl_pips > 0 ? `+${pos().pnl_pips}` : pos().pnl_pips} ${stepRule().unitLabel})`}
              </span>
            </div>
          </td>

          {/* 9. R-Multiple */}
          <td class="text-center pos-cell-r">
            <Show
              when={pos().r_multiple !== null}
              fallback={<span class="text-muted">—</span>}
            >
              <div class="r-multiple-stack">
                <span
                  class="r-multiple-pill tabular-num"
                  classList={{
                    'r-profit': (pos().r_multiple || 0) > 0,
                    'r-loss': (pos().r_multiple || 0) < 0,
                    'r-neutral': (pos().r_multiple || 0) === 0,
                  }}
                  title={pos().initial_sl ? `Floating R based on initial SL: ${pos().initial_sl}` : `Floating R-Multiple`}
                >
                  {preferencesStore.pnlDisplayMode() === 'stealth_mask'
                    ? '••••'
                    : (pos().r_multiple || 0) > 0
                    ? `+${pos().r_multiple} R`
                    : `${pos().r_multiple || 0} R`}
                </span>
                <Show when={(pos().locked_r || 0) > 0}>
                  <span
                    class="r-locked-badge tabular-num"
                    title={`Stop Loss locks in +${pos().locked_r}R profit`}
                  >
                    🔒 +{pos().locked_r}R
                  </span>
                </Show>
              </div>
            </Show>
          </td>

          {/* 10. Quick Actions */}
          <td class="text-right pos-cell-actions">
            <div class="pos-actions-segmented">
              <button
                type="button"
                class="btn-pos-action btn-pos-be"
                onClick={handleMoveToBreakEven}
                disabled={isSubmitting()}
                title={`Instant Break-Even: Move SL to Entry + Spread Offset for #${pos().ticket}`}
              >
                <svg class="btn-pos-svg" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M10 1.944A11.954 11.954 0 012.166 5C2.056 5.649 2 6.319 2 7c0 5.225 3.34 9.67 8 11.317C14.66 16.67 18 12.225 18 7c0-.682-.057-1.35-.166-2.001A11.954 11.954 0 0110 1.944zM11 14a1 1 0 11-2 0 1 1 0 012 0zm0-7a1 1 0 10-2 0v3a1 1 0 102 0V7z" clip-rule="evenodd" />
                </svg>
                <span>BE</span>
              </button>

              <button
                type="button"
                class="btn-pos-action btn-pos-half"
                onClick={() => handleClosePosition(pos().volume / 2)}
                disabled={isSubmitting()}
                title={`Scale Out: Close 50% volume (${(pos().volume / 2).toFixed(2)} Lots) for #${pos().ticket}`}
              >
                <svg class="btn-pos-svg" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M5.5 2a3.5 3.5 0 101.996 6.368l2.584 2.584a3.5 3.5 0 101.414-1.414L8.91 6.954A3.5 3.5 0 005.5 2zm-1.5 3.5a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zm10 8a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0z" clip-rule="evenodd" />
                </svg>
                <span>50%</span>
              </button>

              <button
                type="button"
                class="btn-pos-action btn-pos-close"
                onClick={() => handleClosePosition()}
                disabled={isSubmitting()}
                title={`Liquidate: Close full position (${pos().volume.toFixed(2)} Lots) for #${pos().ticket}`}
              >
                <svg class="btn-pos-svg" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                </svg>
                <span>CLOSE</span>
              </button>
            </div>
          </td>
        </tr>
      )}
    </Show>
  );
};
