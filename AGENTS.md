# 🤖 AGENTS.md — MT5 Risk Management Dashboard Developer & Agent Guide

> **Target Audience**: Autonomous AI Agents and Software Engineers extending, refactoring, or maintaining the `risk_management_dashboard` codebase.

---

## 📌 1. Project Overview & Architecture

The **MT5 Risk Management & Dynamic Lot Sizing Dashboard** is an institutional-grade, real-time risk budgeting and pre-trade execution terminal for MetaTrader 5. It couples mathematical risk modeling (Fixed Fractional, Bounded Dynamic Half-Kelly; Ralph Vince Optimal $f$ deprecated) with high-frequency WebSocket quote streaming and dual-arm execution safety.

### 🏗️ Monorepo & Technology Stack
- **Backend**: Python 3.10+ / FastAPI / Clean Hexagonal Architecture (`domain/`, `application/`, `infrastructure/`, `presentation/`) / `MetaTrader5` IPC library / Asyncio WebSockets.
- **Frontend**: [Solid.js 1.9+](./frontend/package.json) (Zero-VDOM Fine-Grained Reactive Framework) / [TypeScript 5.7+](./frontend/package.json) / [Vite 6.2+](./frontend/package.json).
- **Styling**: Vanilla CSS Design System with Institutional Dark Mode tokens (`#0b0e14` canvas, `#131722` card, `#161b26` inset) and zero-jitter tabular typography (`font-variant-numeric: tabular-nums`).
- **Build Output**: Compiled via Vite directly into `static/dist/`, served automatically by FastAPI.
- **Testing Suites**: Pytest for backend (`uv run pytest`), Vitest + JSDOM for frontend (`npm test` in `frontend/`).
- **License**: [PolyForm Noncommercial License 1.0.0](./LICENSE) (`PolyForm-Noncommercial-1.0.0`). Free for individuals (personal trading & individual prop evaluations); paid commercial license required for enterprise/commercial use.

### 📚 Documentation Taxonomy & Architectural Boundaries
- **`docs/` Directory**: **Strictly Full-Stack & System-Level Architecture Only**. Reserved exclusively for cross-cutting full-stack monographs, quantitative finance models, pre-trade OMS risk math, trading psychology/ergonomics, and MT5 Python IPC concurrency. **Never place frontend-only UI/CSS or backend-isolated implementation notes here.**
- **`frontend/` Directory**: **Frontend-Specific Architecture & Guides**. All frontend design system documentation, Material Design 3 token specifications, Solid.js reactivity patterns, and component guides MUST reside under `frontend/` (e.g. [`frontend/DESIGN_SYSTEM.md`](./frontend/DESIGN_SYSTEM.md) or [`frontend/src/styles/README.md`](./frontend/src/styles/README.md)).

---

## ⚡ 2. Core Frontend Reactivity & Client Engineering (Solid.js)

### ⚠️ Critical Reactivity & Data Rules for Agents:
1. **NEVER Destructure Props**:
   - ❌ **Incorrect**: `const { symbol, onTradeClick } = props;` *(Destroys reactive signal tracking).*
   - ✅ **Correct**: Access directly via `props.symbol` or wrap with `const sym = () => props.symbol;` or use `splitProps(props, [...])`.
2. **Stable Keying in `<For>` Loops (Zero DOM Tearing)**:
   - When iterating over streamed collections (e.g. symbol tables), **never** pass raw object arrays that get re-allocated on every 500ms tick.
   - Always pass an array of stable primitive string identifiers (`<For each={marketStore.filteredSymbols()}>` where `filteredSymbols()` returns `string[]`).
   - Child components (`SymbolRow.tsx`) resolve their own memoized record: `const item = createMemo(() => marketStore.getCalculatedResult(props.symbol));`.
3. **Input Focus Shielding during High-Frequency Updates**:
   - When binding editable inputs (e.g. Stop Loss points) to WebSocket-backed state, track `isFocused()` state paired with a local drafting signal (`localVal`).
   - Only synchronize external state to the input's local signal when `!isFocused()`.
   - Use `onFocus={(e) => e.currentTarget.select()}` for instant 1-keystroke value replacement.
4. **Client-Side Mathematical Separation**:
   - Complex sizing formulas (Half-Kelly fractions, ADR/ATR scaling, margin requirements) run client-side in `src/utils/lotCalculator.ts` in $<5\mu\text{s}$, eliminating network round-trips for real-time recalculations.
5. **Conservative Volume Stepping Invariant (Risk As Strict Ceiling)**:
   - Target risk percentage is a **strict ceiling**, never a target average.
   - Pre-trade lot sizing engines must strictly enforce conservative stepping via flooring with a floating-point epsilon ($+10^{-9}$):
     $$\text{Stepped Lot} = \lfloor \frac{\text{Exact Lot}}{\text{Volume Step}} + 10^{-9} \rfloor \times \text{Volume Step}$$
   - Any change to pre-trade math must maintain identical unit test parity across TypeScript (`lotCalculator.ts`) and Python (`domain/math/risk_models.py`).
6. **Pure HTTP Client Abstraction & Resilient Error Contract**:
   - **Queries** (`fetchAccount`, `fetchPositions`) throw typed `ApiError` on HTTP failure to let UI layers trigger fallback/offline states.
   - **Mutations/Orders** (`executeOrder`, `closePosition`, `modifyPosition`, `flattenAll`) catch underlying transport errors and return typed domain results `{ success: boolean, message: string }`. Click handlers and execution buttons **never** leak unhandled promise rejections.
7. **Class-Internal Dual-Buffer Zero-Allocation Sparklines**:
   - `CircularPriceBuffer` manages both the raw ring buffer (`Float32Array(120)`) and chronological unrolled buffer internally.
   - Calling `getChronological()` yields views and pre-calculated min/max metrics in $<3\mu\text{s}$ with **zero heap allocations** on incoming ticks.
   - Rendering is strictly gated to rows that are **Pinned (`📌`)** or **Hovered**, keeping UI frame rate locked at 60 FPS ($<0.05\text{ms}$ rendering overhead).
8. **Zero-Latency Telemetry Micro-Popovers**:
   - High-density table cells requiring secondary telemetry (e.g. ADR session exhaustion) wrap content in a relative container (`.adr-cell-wrapper`) and toggle micro-popover cards (`.adr-telemetry-popover`).
   - Floating cards MUST declare `pointer-events: none` to eliminate hover flickering and prevent intercepting clicks on underlying table rows or BUY/SELL execution buttons.
9. **Overlay State Singularity**:
   - Any component hosting multiple contextual overlay cards or popovers (e.g. command bar pills) must govern active overlay visibility via a single union state type (`createSignal<'account' | 'stats' | 'none'>('none')`), never independent boolean flags.
10. **The M3 `on-*` Semantic Text Contrast Invariant**:
   - Interactive buttons or chips that consume themeable action backgrounds (`--sys-color-buy`, `--sys-color-scale`, `--sys-color-flatten`) MUST bind text color to paired `--sys-color-on-*` semantic tokens. Never hardcode `#ffffff` text on backgrounds that map to high-luminance colors (e.g. `#00b4d8` Electric Cyan in CVD mode).

---

## 🗄️ 3. State Management Architecture (`createRoot` Singletons)

All shared application state lives in singleton stores initialized via `createRoot`:

```
risk_management_dashboard/frontend/src/stores/
├── accountStore.ts        # MT5 Live Balance, Equity, Leverage, Margin Free, Server Info, Connection status
├── marketStore.ts         # Raw symbol quotes, 14D ADR, trade stats, sorting, category filtering, drag-and-drop
├── positionsStore.ts      # Real-time open MT5 positions, total floating P&L, 1R normalization, emergency close state
├── preferencesStore.ts    # Working Capital memo + MT5 fallback, Risk model, SL mode, Turbo mode, localStorage
└── toastStore.ts          # Floating toast alerts queue
```

### Key Store Conventions:
- **Working Capital Fallback Pattern**:
  `preferencesStore.workingCapital` is a reactive `createMemo`. If a custom dollar amount is saved in `localStorage`, it takes priority. If unset or cleared via "Sync Balance", it reactively tracks live `accountStore.account().balance` (defaulting to \$100.00 if balance is 0).
- **SL Overrides**:
  Symbol-specific Stop Loss customizations are stored in `preferencesStore.slOverrides` as a dictionary `{ [symbol]: pips }` persisted in `localStorage` under `mt5_sl_overrides`. The reset button `↺` deletes the key and restores global preset sizing.
- **Van Tharp 1R Baseline Resolution Order**:
  `positionsStore.oneRCash()` reactively resolves baseline $1R$ dollar risk:
  $$1R_{\text{cash}} = \text{Working Capital} \times \frac{\text{Target Risk \%}}{100}$$
  Falls back strictly to `$100.00` if Working Capital is 0 during boot to avoid `NaN` or zero-division crashes across client math.
- **Unified Emergency Liquidation Control**:
  Per [`docs/01_institutional_terminal_design.md`](./docs/01_institutional_terminal_design.md), emergency liquidation is a **single unified action**: **"Flatten All ($0\Delta$)"** (Net Delta $\to 0.00$), protected by a two-phase 4-second safety arming countdown. Never place segmented mode switches adjacent to emergency controls.

---

## 🎨 4. Institutional UI/UX Design System & Ergonomics

```
Surface Layering:
┌────────────────────────────────────────────────────────┐
│  BASE CANVAS: #0b0e14                                  │
│  ┌──────────────────────────────────────────────────┐  │
│  │  CARD / PANEL: #131722 (Border: 1px solid #1f2533)│  │
│  │  ┌────────────────────────────────────────────┐  │  │
│  │  │  INPUT / INSET: #161b26 (Border: #283044)  │  │  │
│  │  └────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

### 🏛️ 3-Layer Design Token Architecture (M3 Standard)
The frontend styling system is strictly partitioned into 3 decoupled layers under `frontend/src/styles/`:
1. **Layer 1: Primitives** (`tokens/primitives.css` via `--ref-*`):
   Context-free raw values (palettes, spacing scales `2px–48px`, radii scales, elevation shadows, typography stacks, easing curves).
2. **Layer 2: Semantics** (`tokens/semantic.css` via `--sys-*`):
   Dark-mode institutional roles (`--sys-color-surface`, `--sys-color-outline`, `--sys-color-on-surface`, etc.) and pre-trade execution semantics (`--sys-color-buy`, `--sys-color-sell`, `--sys-color-profit`, `--sys-color-loss`, `--sys-color-warning`). Supports Universal CVD Cyan/Amber via root `data-colorway` attribute.
3. **Layer 3: Views** (`views/*.css`):
   Modularized view stylesheets:
   - `main.css`: App shell, layout, header command bar, controls, stats banner, common modals, toasts.
   - `matrix.css`: Risk screener table, filters, 14D ADR micro-gauges, Stop Loss inline editor, dynamic lot sizing, BUY/SELL triggers.
   - `positions.css`: Open positions table, floating P&L, dedicated SL/TP cells, SL/TP Hub modal, bulk toolbar.
- **Master Entrypoint** (`frontend/src/index.css`):
   Acts as a clean barrel stylesheet importing all layers in cascade order.
- **Strict Enforcement Rule**:
   Never use hardcoded hex colors or legacy `--bg-*` / `--accent-*` tokens in component styles. Always consume `--sys-*` tokens.

### 📐 Table Schedule & Layout Ergonomics
- **Harmonized 7-Column Screener Table Schedule ($1040\text{px}$ Baseline)**:
  - `Symbol`: `165px` (drag handle, pin, symbol ticker)
  - `Market Price (Spread)`: `190px` (accommodates $60\text{px}$ sparkline + $10\text{px}$ gap + multi-digit bid/ask stack)
  - `14D ADR`: `110px` (tactile pips remaining, session exhaustion %, hairline progress bar)
  - `Stop Loss`: `120px` ($76\text{px}$ numeric input, auto-selects on focus, reset `↺` badge)
  - `Lot Size`: `115px` (**Single Source of Truth** for calculated volume + sort header + smart ⚠️ clamp alert)
  - `Effective Risk (Margin)`: `170px` (Stacked `$85.84 (1.00%)` on top + `Margin: 0.4%` below)
  - `Execute`: `170px` (Invariant dual-button cluster + hover glow halos)
- **Viewport Eye Drift Containment**:
  All primary screener grid wrappers (`.matrix-section`) must declare `max-width: 1440px; margin: 0 auto; width: 100%;` to contain saccadic eye motion on ultra-wide monitors.
- **Two-Line Tabular Telemetry Invariant**:
  - **Line 1 (Geometry)**: Absolute broker price level (`1.08450`), formatted strictly to instrument digits.
  - **Line 2 (Telemetry)**: Contextual metric driven by `pnlDisplayMode` (`currency`, `r_multiple`, or `stealth_mask`), backed by a 3D hover tooltip.

### 🔒 Dual-Arm Execution Safety & Invariant Hitbox Ergonomics
1. **Strict Invariant Hitbox Rule (Fitts's Law)**:
   - Matrix execution triggers have **strictly locked geometry**: `width: 64px; min-width: 64px; max-width: 64px; height: 30px` inside a fixed `136px` container (`gap: 8px`).
   - State transitions (Resting $\to$ Armed $\to$ Depressed $\to$ In-Flight $\to$ Fill Flash) are conveyed purely via border glows, a 2px hairline dwell countdown bar along the bottom edge, and centered glyphs (`✓`/`✕`), **never by altering element dimensions or expanding label strings**.
2. **Instant Pivot Execution Contract**:
   - In the dual-arm safety system, the un-armed opposing button remains interactive (`pointer-events: auto`) while dimmed. Clicking the opposing button immediately disarms the first direction and arms the second in a single gesture.
3. **Cognitive Asymmetry (Fill 400ms vs. Rejection Dwell)**:
   - Fills (`✓`) return to resting quickly (**400ms**). Rejections (`✕`) require longer visual dwell time and accompanying toast notifications to ensure human cognitive acknowledgment.
4. **Smart ⚠️ Risk Alert Logic**:
   - The warning icon only fires if minimum broker lot or volume step limits cause effective risk to deviate from target by **$> 10\%$**:
     `Math.abs(effective - target) / target > 0.10`.

### 🕶️ Psychological De-Biasing & Stealth Standard
1. **Uniform Stealth Standard**:
   - When `pnlDisplayMode === 'stealth_mask'`, all financial figures (BAL, WC, FREE, EQ, P&L, Heat) render as invariant Unicode bullet sequences (`••••••`), with points/pips displayed as `(•••• p)`. Never prefix masked bullets with currency symbols (`$••••••` $\to$ `••••••`).
   - Target risk percentage (`(1.00% of WC)`) **must remain visible at all times** to maintain pre-trade safety awareness.
2. **300ms Native Tooltip Inspection Contract**:
   - Any metric masked for de-biasing or stealth privacy must provide an unmasked native `title` attribute for intentional hover-to-reveal.
3. **GPU-Composited Hardware Tick Flashers**:
   - Tick flasher components use GPU-composited pseudo-elements (`::before`) with `opacity` decay and `transform: translateZ(0)` / `will-change: opacity` (instant 0ms attack, 350ms decay), isolating repaints from the layout engine.

---

## 🏛️ 5. Backend Architecture & Concurrency Model

### 🧩 Clean Hexagonal Architecture
```
risk_management_dashboard/
├── config/              # Pydantic v2 Settings (Host, Port, Turbo Interval, Safety Caps)
├── domain/              # PURE DOMAIN (Zero I/O, Zero MT5 imports, 100% Unit Testable)
│   ├── models/          # AccountState, SymbolSpec, Position, TradeRecord, TradeStats
│   ├── math/            # risk_models.py, margin_engine.py, break_even.py, volatility.py
│   └── safety/          # gatekeeper.py (Spread surge, Pre-flight margin limits)
├── infrastructure/      # INFRASTRUCTURE & I/O ADAPTERS
│   ├── ipc/             # mt5_worker.py (Single-threaded serialized MT5 executor)
│   ├── providers/       # base.py (IMarketDataProvider, IExecutionProvider), mt5_provider.py, mock_provider.py
│   └── cache/           # memory_store.py (Thread-safe cache & spread ring-buffers)
├── application/         # APPLICATION SERVICES & USE CASES
│   ├── market_service.py        # Market data orchestration & volatility caching
│   ├── execution_service.py     # Order placement, break-even snapping, partial close
│   ├── liquidation_service.py   # Smart Flatten vs Close All engine
│   └── broadcaster.py           # Centralized Pub/Sub WebSocket broadcast hub
├── presentation/        # PRESENTATION LAYER (FastAPI)
│   ├── dependencies.py          # FastAPI Depends() injection container
│   ├── routers/                 # account.py, symbols.py, trades.py, orders.py, positions.py
│   └── websocket/               # live_stream.py (/ws/live hub subscriber)
└── tests/               # Separated unit/ and integration/ test suites
```

### ⚙️ Concurrency & Provider Invariants
1. **Dedicated Single-Threaded MT5 IPC Worker (`MT5IPCWorker.call()`)**:
   - MetaTrader 5's `.pyd` Win32 IPC channel relies on thread-local resources and named pipe state.
   - All MT5 C-extension invocations must run on a dedicated serial thread (`ThreadPoolExecutor(max_workers=1, thread_name_prefix="MT5_IPC_Serial")`) via `self._ipc_worker.call(...)`.
   - **Never acquire the IPC worker lock on the caller thread** (prevents mutex deadlock on startup).
2. **MetaTrader 5 Symbol Discovery**:
   - In `_sync_market_watch_symbols()`, filter strictly by `getattr(s, "visible", False)` to keep the screener synchronized with the trader's active Market Watch window.
3. **Domain Model Purity & Attribute Access Only**:
   - Domain models are immutable Pydantic v2 classes (`DomainModel`).
   - **DO NOT implement dictionary subscripting (`__getitem__`, `__contains__`, `get`) on Domain Models**.
   - Tests and domain services strictly access model fields via dot-notation (`pos.r_multiple`, `sym.adr_14_pips`).
   - `.model_dump()` is permitted **strictly at network boundaries** (`presentation/routers/` or `presentation/websocket/`).
4. **Single Background Pub/Sub Broadcast Hub (`BroadcastHub`)**:
   - Single producer coroutine samples MT5 at 500ms (Turbo) or 2000ms (Normal) and broadcasts frames to all registered WebSockets, eliminating per-client polling storms.
5. **Two-Phase Emergency Liquidation Sequence**:
   - Emergency account liquidation routines must always execute: `cancel_all_orders()` $\to$ `close_all_positions()` to guarantee $0.00$ Net Delta.
6. **Provider Singleton Coupling in Application Factories**:
   - `create_app()` must default to the module-level singleton instance (`... else feed`), avoiding duplicate disconnected provider instances during tests.

---

## ⌨️ 6. Keyboard Shortcut Schema

| Key | Action | Scope | Notes |
| :--- | :--- | :--- | :--- |
| `1` | Switch to **Risk Matrix Screener** view | Global | Instant view flip |
| `2` | Switch to **Live Open Positions** view | Global | Instant view flip |
| `/` | Focus symbol search input | Global | Trapped from trade triggers |
| `H` | Cycle PnL display mode (`currency` $\to$ `r_multiple` $\to$ `stealth_mask`) | Global | Guarded: ignored if input/textarea is focused |
| `Escape` | Close any open modal, disarm execution, or clear search | Global | Safety disarming priority |
| `Enter` | Commit inline Stop Loss input and drop focus | Inside SL Input | Instant numeric commit |
| `Double-Click` | Open **Deep-Dive Multi-Model Math Breakdown** for symbol row | Matrix Table Row | Pre-trade quantitative audit |

---

## 🛠️ 7. Build, Test, & Execution Commands

Always use `uv` for Python environments and `npm` in `frontend/`:

```bash
# 1. Run Frontend Unit Tests & Typecheck
cd frontend
npm test             # Runs Vitest + JSDOM suite (23 unit tests)
npm run typecheck    # TypeScript compiler strict check
npm run build        # Compiles Vite output to ../static/dist/ in ~700ms

# 2. Run Backend Test Suite
cd ..
uv run pytest        # Runs all 64 unit tests across test_risk_calculator.py and tests/unit/

# 3. Start Development Server
uv run python run.py
```

---

## 📋 8. Agent Checklist Before Committing Changes

- [ ] Ran `npm run build` inside `frontend/` and confirmed 0 compilation errors or TypeScript warnings.
- [ ] Ran `npm test` inside `frontend/` and confirmed all Vitest tests pass.
- [ ] Ran `uv run pytest` in project root and confirmed all 64 backend tests pass.
- [ ] Checked that Solid.js props are not destructured anywhere in TSX components.
- [ ] Ensured numerical inputs are governed by `tabular-nums` and contrast ratios satisfy WCAG AA ($> 4.5:1$).
- [ ] Confirmed that 500ms Turbo Mode streaming does not cause input focus resets or DOM tearing (`isFocused` shielding).
- [ ] Confirmed any frontend-specific architecture docs live in `frontend/` (not in `docs/`).
- [ ] Confirmed all stylesheet modifications exclusively consume `--sys-*` semantic tokens (zero legacy tokens or raw hex colors).
- [ ] Confirmed domain models and provider interfaces strictly return typed models (no dictionary emulation methods or `.model_dump()` conversions within business layers).
- [ ] Confirmed invariant execution button dimensions (`64px` inside `136px` cluster) are preserved.
- [ ] Confirmed conservative lot sizing stepping uses flooring with $+10^{-9}$ epsilon across both TypeScript and Python.

