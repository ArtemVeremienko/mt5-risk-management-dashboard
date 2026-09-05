# 🏛️ MT5 Terminal Frontend: Comprehensive Refactoring Plan

**Target Architecture**: Clean Architecture / Domain-Driven UI with Solid.js Fine-Grained Reactivity  
**Scope**: `frontend/src/`  
**Governing Standard**: `AGENTS.md` (§2 Reactivity, §3 Stores, §4 Design System, §5 Hotkeys, §7 Checklist)

---

## 📋 Executive Summary

This refactoring plan resolves structural anti-patterns, real-time input handling defects, domain-logic leaks, and design-token violations in the MT5 Terminal frontend across four disciplined phases.

---

## 🗺️ Implementation Phases

### Phase 1: High-Priority Fixes & Safety Patches (Immediate)
Focus: Prevent runtime crashes, fix user input trapping, and harden HTTP communication.

1. **Fix `SymbolRow.tsx` Stop Loss Input Trapping**:
   - Decouple keystroke drafting from committing.
   - Prevent `handleSlCommit` from resetting `localVal` while user is typing or backspacing to an empty/partial string.
   - Commit valid inputs live, and commit final values / resets on `onBlur` and `onKeyDown (Enter)`.
2. **Numeric Crash Guard in `lotCalculator.ts`**:
   - Guard against non-positive `volume_step` (`volumeStep <= 0`) which produces `-Math.log10(0) = Infinity` and throws `RangeError: toFixed() digits argument must be between 0 and 100`.
   - Clamp decimal precision safely between `0` and `8`.
3. **Guard Zero-Division & Remove Redundancy in `portfolioAnalytics.ts`**:
   - Guard `pipSize <= 0` with safe fallback (`0.0001` for 3/5 digits, `0.01` for others) to prevent `Infinity` distance.
   - Eliminate redundant ternary `(pos.digits === 3 || pos.digits === 5 ? 10.0 : 10.0)`.
4. **HTTP Status Check & Resilience in `api.ts`**:
   - Add status checking (`res.ok`) to `executeOrder`, `closePosition`, and `modifyPosition` with fallback error message extraction.

---

### Phase 2: Domain Layer Extraction & God-Component Decomposition
Focus: Extract financial mathematics out of JSX presentation into pure, testable domain utilities.

1. **Extract `utils/positionMath.ts`**:
   - Migrate 3-way bidirectional conversions ($\text{Price} \leftrightarrow \text{Pips} \leftrightarrow \text{Cash}$) out of `PositionRow.tsx`.
   - Functions: `slPriceToPipsAndCash`, `slPipsToPriceAndCash`, `slCashToPriceAndPips`, `calculateBreakEvenPrice`.
2. **Decompose `PositionRow.tsx`**:
   - Separate the 400-line inline editing popover into `components/positions/SltpEditHub.tsx`.
   - Reduce `PositionRow.tsx` from 1,157 lines to $< 200$ lines, strictly focused on table row presentation.
3. **Consolidate $1R$ Normalization**:
   - Add `normalizePnLToR(pnl, workingCapital, riskPct)` in `portfolioAnalytics.ts`.
   - Replace 5 duplicated inline IIFEs across `HeaderMetricsBar.tsx` and `OrderManagementPanel.tsx`.
   - Expose reactive memos `positionsStore.floatingRMultiple` and `positionsStore.portfolioHeatR`.
4. **Deduplicate Stop-Loss Presets Formula**:
   - Centralize ADR/ATR fraction calculations (`1/4 ADR`, `1/3 ADR`, `1/2 ADR`, `1 ADR`, `1 ATR`) in `lotCalculator.ts` via `computeDefaultSlPips(spec, slMode)`.
   - Eliminate redundant duplicate logic in `SymbolRow.tsx`.

---

### Phase 3: Constants & Design Token Compliance
Focus: Eliminate magic numbers and enforce the 3-Layer Design System (`--sys-*`).

1. **Create `src/config/constants.ts`**:
   - `STORAGE_KEYS`: Typed dictionary for all 19 `localStorage` keys.
   - `RISK_THRESHOLDS`: `RISK_ALERT_TOLERANCE = 0.10`, `SPREAD_SURGE_THRESHOLD = 2.0`, `MAX_MARGIN_UTILIZATION = 0.95`, `ARMED_DWELL_TIMEOUT_MS = 5000`.
   - `DEFAULT_LEVERAGE = 300` (resolving discrepancy between `accountStore` and `HeaderMetricsBar`).
2. **Purge Raw Hex Colors in TSX & CSS**:
   - Replace inline styles in `HeaderMetricsBar.tsx`, `RiskConfigModal.tsx`, `RiskControlsBar.tsx` with semantic CSS classes.
   - Refactor `positions.css` and `matrix.css` to replace $> 250$ raw hex colors with `--sys-color-*` semantic tokens.
3. **Tokenize Canvas Sparklines**:
   - In `MicroSparkline.tsx`, query `--sys-color-profit` and `--sys-color-loss` dynamically from computed styles for canvas 2D context strokes.

---

### Phase 4: Performance & Reactive Scaling
Focus: Minimize fine-grained recalculation overhead during 500ms Turbo Mode quote streaming.

1. **Targeted Store Slices**:
   - Optimize `marketStore.calculatedResultsMap` from recomputing the full symbol universe on every single tick to dirty-checking updated symbol quotes.
2. **Strict Timer Types**:
   - Replace `let armedTimer: any;` with `ReturnType<typeof setTimeout> | undefined` across `SymbolRow.tsx` and `OrderManagementPanel.tsx`.

---

## 🔍 Verification & Acceptance Criteria
- `npm run build` in `frontend/` succeeds with 0 errors.
- `uv run pytest test_risk_calculator.py` passes with 0 failures.
- Stop Loss input allows full text editing/clearing without snapping back on keystroke.
- No `RangeError` on atypical broker symbol specifications.
