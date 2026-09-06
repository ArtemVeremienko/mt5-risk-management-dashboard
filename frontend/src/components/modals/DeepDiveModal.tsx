import { Component, Show } from 'solid-js';
import { CalculatedSymbolResult } from '../../types';
import { preferencesStore } from '../../stores/preferencesStore';
import { formatCurrency } from '../../utils/formatters';

interface Props {
  item: CalculatedSymbolResult | null;
  onClose: () => void;
}

export const DeepDiveModal: Component<Props> = (props) => {
  return (
    <Show when={props.item}>
      {(item) => (
        <div class="modal-backdrop" onClick={props.onClose}>
          <div class="modal-card modal-lg" onClick={(e) => e.stopPropagation()}>
            <div class="modal-header">
              <div class="modal-title-group">
                <span class="modal-icon">🔍</span>
                <h3 class="modal-title">
                  {item().spec.symbol} — Risk Math & Multi-Model Breakdown
                </h3>
              </div>
              <button class="modal-close-btn" onClick={props.onClose}>
                ✕
              </button>
            </div>

            <div class="modal-body">
              <div class="deep-dive-grid">
                <div class="deep-dive-card">
                  <div class="card-subtitle">BROKER SPECIFICATIONS</div>
                  <div class="spec-row">
                    <span class="spec-label">Contract Size:</span>
                    <span class="spec-val">{item().spec.trade_contract_size?.toLocaleString()}</span>
                  </div>
                  <div class="spec-row">
                    <span class="spec-label">Pip Size / Digits:</span>
                    <span class="spec-val">{item().spec.pip_size} ({item().spec.digits}d)</span>
                  </div>
                  <div class="spec-row">
                    <span class="spec-label">Pip Value per Lot:</span>
                    <span class="spec-val">${item().calc.pip_val_display}</span>
                  </div>
                  <div class="spec-row">
                    <span class="spec-label">Min / Max Volume:</span>
                    <span class="spec-val">{item().calc.min_volume} / {item().calc.max_volume}</span>
                  </div>
                  <div class="spec-row">
                    <span class="spec-label">Volume Step:</span>
                    <span class="spec-val">{item().calc.volume_step}</span>
                  </div>
                  <div class="spec-row">
                    <span class="spec-label">14D ADR / ATR:</span>
                    <span class="spec-val">{item().spec.adr_display} p / {item().spec.atr_display} p</span>
                  </div>
                </div>

                <div class="deep-dive-card">
                  <div class="card-subtitle">ACTIVE POSITION SIZING FORMULA</div>
                  <div class="spec-row">
                    <span class="spec-label">Working Capital:</span>
                    <span class="spec-val">
                      {preferencesStore.pnlDisplayMode() !== 'currency'
                        ? '••••••'
                        : formatCurrency(item().calc.working_capital)}
                    </span>
                  </div>
                  <div class="spec-row">
                    <span class="spec-label">Selected Risk Model:</span>
                    <span class="spec-val text-accent">{item().calc.risk_method}</span>
                  </div>
                  <div class="spec-row">
                    <span class="spec-label">
                      {preferencesStore.pnlDisplayMode() === 'r_multiple'
                        ? 'Target Risk (% / R):'
                        : 'Target Risk (% / $):'}
                    </span>
                    <span class="spec-val">
                      {preferencesStore.pnlDisplayMode() === 'r_multiple'
                        ? `${item().calc.target_risk_pct.toFixed(2)}% (1.00 R)`
                        : preferencesStore.pnlDisplayMode() === 'stealth_mask'
                          ? `${item().calc.target_risk_pct.toFixed(2)}% (••••••)`
                          : `${item().calc.target_risk_pct.toFixed(2)}% (${formatCurrency(item().calc.target_risk_amount)})`}
                    </span>
                  </div>
                  <div class="spec-row">
                    <span class="spec-label">Stop Loss:</span>
                    <span class="spec-val">{item().calc.sl_pips} Pips</span>
                  </div>
                  <div class="spec-row">
                    <span class="spec-label">Theoretical Exact Lot:</span>
                    <span class="spec-val font-mono">{item().calc.exact_lot_display}</span>
                  </div>
                  <div class="spec-row">
                    <span class="spec-label">Broker Executable Lot:</span>
                    <strong class="spec-val text-accent font-mono">{item().calc.lot_display}</strong>
                  </div>
                  <div class="spec-row">
                    <span class="spec-label">
                      {preferencesStore.pnlDisplayMode() === 'r_multiple'
                        ? 'Effective Risk (% / R):'
                        : 'Effective Risk (% / $):'}
                    </span>
                    <span class="spec-val">
                      {preferencesStore.pnlDisplayMode() === 'r_multiple'
                        ? `${item().calc.effective_risk_pct.toFixed(2)}% (${(item().calc.target_risk_amount > 0 ? (item().calc.effective_risk_amount / item().calc.target_risk_amount).toFixed(2) : '1.00')} R)`
                        : preferencesStore.pnlDisplayMode() === 'stealth_mask'
                          ? `${item().calc.effective_risk_pct.toFixed(2)}% (••••••)`
                          : item().calc.risk_display}
                    </span>
                  </div>
                  <div class="spec-row">
                    <span class="spec-label">Required Margin:</span>
                    <span class="spec-val">
                      {preferencesStore.pnlDisplayMode() === 'r_multiple'
                        ? `${item().calc.margin_utilization_display}% of Deposit`
                        : `${formatCurrency(item().calc.required_margin)} (${item().calc.margin_utilization_display}%)`}
                    </span>
                  </div>
                </div>
              </div>

              <div class="multi-model-comparison-table-wrapper">
                <div class="card-subtitle">MULTI-MODEL POSITION SIZING COMPARISON</div>
                <table class="comparison-table">
                  <thead>
                    <tr>
                      <th>Sizing Strategy</th>
                      <th>Target Risk</th>
                      <th>Executable Lot</th>
                      <th>{preferencesStore.pnlDisplayMode() === 'r_multiple' ? 'Risk (R)' : 'Dollar Risk'}</th>
                      <th>Required Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><strong>Fixed Fractional (1.0%)</strong></td>
                      <td>1.0%</td>
                      <td>{item().comparison.fractional_1pct.lot} Lot</td>
                      <td>
                        {preferencesStore.pnlDisplayMode() === 'r_multiple'
                          ? item().calc.target_risk_amount > 0
                            ? `${(item().comparison.fractional_1pct.risk_amount / item().calc.target_risk_amount).toFixed(2)} R`
                            : '1.00 R'
                          : formatCurrency(item().comparison.fractional_1pct.risk_amount)}
                      </td>
                      <td>
                        {preferencesStore.pnlDisplayMode() === 'r_multiple' && item().calc.working_capital > 0
                          ? `${((item().comparison.fractional_1pct.margin / item().calc.working_capital) * 100).toFixed(1)}%`
                          : formatCurrency(item().comparison.fractional_1pct.margin)}
                      </td>
                    </tr>
                    <tr>
                      <td><strong>Dynamic Half-Kelly (Bounded)</strong></td>
                      <td>{item().comparison.half_kelly.risk_pct.toFixed(2)}%</td>
                      <td>{item().comparison.half_kelly.lot} Lot</td>
                      <td>
                        {preferencesStore.pnlDisplayMode() === 'r_multiple'
                          ? item().calc.target_risk_amount > 0
                            ? `${(item().comparison.half_kelly.risk_amount / item().calc.target_risk_amount).toFixed(2)} R`
                            : `${(item().comparison.half_kelly.risk_pct / (item().calc.target_risk_pct || 1.0)).toFixed(2)} R`
                          : formatCurrency(item().comparison.half_kelly.risk_amount)}
                      </td>
                      <td>
                        {preferencesStore.pnlDisplayMode() === 'r_multiple' && item().calc.working_capital > 0
                          ? `${((item().comparison.half_kelly.margin / item().calc.working_capital) * 100).toFixed(1)}%`
                          : formatCurrency(item().comparison.half_kelly.margin)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div class="modal-footer">
              <button class="btn-primary" onClick={props.onClose}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
};
