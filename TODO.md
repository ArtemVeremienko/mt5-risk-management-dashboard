# 🎯 MT5 Risk Management Dashboard — Project Roadmap & Next Steps

> 📚 **System Guides & Architecture**:
> - **Hexagonal Concurrency & Streaming Blueprint**: [`ARCHITECTURE.md`](./ARCHITECTURE.md)
> - **Developer Rules & Design Tokens**: [`AGENTS.md`](./AGENTS.md)
> - **Historical Refactoring & Deep Retrospective**: [`SESSION_LEARNINGS.md`](./SESSION_LEARNINGS.md)
> - **Socket Push Protocol Specifications**: [`STREAMING_PLAN.md`](./STREAMING_PLAN.md)

---

## 📊 Roadmap Status Overview

| Phase | Milestone / Domain | Status | Key Deliverable |
| :---: | :--- | :---: | :--- |
| **Phases 1–5** | **Core Terminal, Ergonomics & OMS Engine** | **Completed** | Full Hexagonal backend, Solid.js UI, dual-arm safety, session ADR micro-gauges, Smart Flatten ($0\Delta$). |
| **Math Tests** | **Frontend Quantitative Math Test Suites** | **Completed** | 75 Vitest unit tests covering lot sizing, 4-way position math, sparkline buffer, and portfolio heat. |
| **Phase 6** | **Native MQL5 TCP Socket Push Bridge** | **Next Up (P0)** | Sub-ms NDJSON streaming via `RiskBridgeEA.mq5` and FastAPI `asyncio.start_server`. |
| **Phase 7** | **Pre-Trade Safety Ceiling & OMS Interlocks** | **Planned (P1)** | Configurable hard risk ceiling (`mt5_max_risk_ceiling`), broker clamp alerts, and spread surge settings. |
| **Phase 8** | **Live Terminal Integration & E2E Validation** | **Planned (P2)** | Live broker demo testing, fast tick streaming verification, and automated E2E test runs. |

---

## 🚀 Active & Upcoming Milestones

### ⚡ Phase 6: Native MQL5 TCP Socket Push & RPC Bridge (`RiskBridgeEA.mq5`)
> 📚 **Reference Specification**: See [`STREAMING_PLAN.md`](./STREAMING_PLAN.md) for wire protocol, NDJSON frames, and MT5 socket architectures.

- [ ] **Native Zero-DLL Socket Push EA (`RiskBridgeEA.mq5`)**:
  - Non-blocking client sockets (`SocketCreate`, `SocketConnect`, `SocketSend`) implemented natively in MQL5 without external Win32 DLLs.
  - Stream sub-millisecond price ticks on `OnTick()` to TCP port `:9090` using NDJSON framing.
  - Stream transaction and fill events on `OnTradeTransaction()` for real-time blotter synchronization without polling delays.
- [ ] **Bidirectional RPC Execution Channel (`:9091`)**:
  - Implement a dedicated TCP RPC socket server on port `:9091` for instantaneous order placement, SL/TP modifications, and batch liquidations.
  - Sub-millisecond execution response avoiding python C-extension mutex contention.
- [ ] **FastAPI TCP Ingestion Layer & Broadcaster Integration**:
  - Background `asyncio.start_server` listener in FastAPI consuming incoming NDJSON tick packets directly into [`BroadcastHub`](./application/broadcaster.py).
  - Eliminate all IPC thread hops for market tick updates when EA is active.
- [ ] **Dynamic Provider Promotion & Transparent Fallback Hierarchy**:
  - Auto-promote `MQL5SocketPushProvider` to active market provider when `RiskBridgeEA.mq5` connects.
  - Seamless zero-downtime automatic fallback to [`MT5NativeProvider`](./infrastructure/providers/mt5_provider.py) (polling over Win32 IPC) if the EA drops or disconnects.
  - Maintain [`MockDataProvider`](./infrastructure/providers/mock_provider.py) for offline development and CI environments.
- [ ] **UI Driver Telemetry Badge**:
  - Header badge in Solid.js terminal displaying live driver state: `⚡ Push: Active (<1ms)` vs `🔄 IPC Polling (500ms)`.

---

### 🛡️ Phase 7: Institutional Pre-Trade Safety Hard Ceiling & Configurable Controls
> 📚 **Reference Standards**: See [`docs/03_matrix_execution_and_oms.md`](./docs/03_matrix_execution_and_oms.md) & [`AGENTS.md`](./AGENTS.md).

- [ ] **Max Risk Per Trade Hard Ceiling (`mt5_max_risk_ceiling`)**:
  - Add configurable hard ceiling in [`RiskConfigModal.tsx`](./frontend/src/components/modals/RiskConfigModal.tsx) (default `2.50%` of Working Capital).
  - Pre-flight rejection: visually block execution buttons with an alert badge (`🛑 Risk Ceiling Exceeded`) when broker minimum lot sizes would force dollar risk past the ceiling on small accounts.
  - Intercept and reject in backend [`PreTradeGatekeeper`](./domain/safety/gatekeeper.py) if incoming order payload breaches configured ceiling.
- [ ] **User-Configurable Spread Surge Multipliers**:
  - Expose spread surge thresholds in Settings:
    - Warning highlight threshold (default `2.0×` rolling median).
    - Double-arm lock threshold (default `2.5×` rolling median).
- [ ] **One-Click Quick Preset SL Customization**:
  - Allow traders to define custom quick snap chips (e.g. `🎯 1.0 R`, `📐 20 p`, `📐 0.5 ADR`) within the Settings modal, persisted in `localStorage`.

---

### 🧪 Phase 8: Live Demo Integration & End-to-End Broker Verification
- [ ] **Live MetaTrader 5 Terminal Demo Verification**:
  - Connect terminal to an active MetaTrader 5 demo account (Forex, Metals, Indices).
  - Verify 500ms Turbo Mode streaming under high market activity with zero UI frame drops.
  - Test dual-arm safety execution across all 5 states (Resting $\to$ Armed $\to$ Depressed $\to$ In-Flight $\to$ Fill Flash).
- [ ] **Two-Phase Smart Flatten Live Verification**:
  - Place live pending orders (Buy Limit, Sell Stop) alongside open positions.
  - Trigger "Flatten All ($0\Delta$)" and verify atomic two-phase purge: 100% pending orders canceled, 100% market positions liquidated, leaving true $\$0.00$ Net Delta.
- [ ] **Automated Headless Browser End-to-End Suite**:
  - Expand [`browser_test.py`](./browser_test.py) to validate full interaction lifecycle: SL inline editing, modal parameter overrides, hotkey navigation (`1`, `2`, `/`, `H`, `Escape`).

---

## 🏛️ Completed Milestones Archive (Phases 1–5 Summary)

All core architecture, math, safety interlocks, and design systems have been fully implemented and verified across 64 backend pytest tests and 75 frontend Vitest tests. Full architectural details and retrospectives reside in [`SESSION_LEARNINGS.md §15`](./SESSION_LEARNINGS.md#L484-L525) and [`ARCHITECTURE.md`](./ARCHITECTURE.md).

### 1. ⚡ Core Performance, Streaming & Clean Hexagonal Architecture
* [x] **Centralized Pub/Sub Broadcast Hub**: Single-producer multi-consumer [`BroadcastHub`](./application/broadcaster.py) eliminating per-client polling storms.
* [x] **Single-Threaded Serial MT5 Worker**: [`MT5IPCWorker.call()`](./infrastructure/ipc/mt5_worker.py) pinning calls to a dedicated OS thread, preventing Win32 IPC handle corruption (`0xC0000005`) and startup mutex deadlocks.
* [x] **Decoupled 15-Minute Volatility Cache**: Background TTL caching for 14-day D1 ADR/ATR calculations, keeping live quote streaming sub-millisecond.
* [x] **Provider Abstraction Layer**: Standardized [`IMarketDataProvider`](./infrastructure/providers/base.py) and [`IExecutionProvider`](./infrastructure/providers/base.py) with [`MT5NativeProvider`](./infrastructure/providers/mt5_provider.py) and [`MockDataProvider`](./infrastructure/providers/mock_provider.py).
* [x] **Domain Model Purity**: Immutable Pydantic v2 domain models with dot-notation attribute access; eliminated dict-emulation hacks.

### 2. 🔒 Dual-Arm Execution Safety & Institutional Ergonomics
* [x] **5-State Invariant Hitbox Execution Engine**: Execution buttons strictly locked to `64px` inside `136px` cluster within $170\text{px}$ column. State transitions conveyed via border glows, 2px hairline dwell countdown bar, and centered glyphs (`✓`/`✕`), preserving Fitts's Law.
* [x] **Decaying Auto-Disarm Safety Gate**: 5.0-second decaying countdown with Instant Pivot execution contract (opposing direction remains interactive and disarms/arms in a single click).
* [x] **Cognitive Asymmetry**: 400ms fill flash vs prolonged visual dwell for rejections to guarantee human acknowledgment.
* [x] **Atomic Two-Phase Smart Flatten**: [`LiquidationService.flatten_all()`](./application/liquidation_service.py) canceling 100% of pending orders prior to market liquidation, guaranteeing $\$0.00$ Net Delta.

### 3. 🧠 Cognitive Ergonomics, Psychological De-Biasing & Design Tokens
* [x] **Stealth PnL & Normalized $R$-Multiple HUD**: Multi-mode telemetry (`currency` $\to$ `r_multiple` $\to$ `stealth_mask`) toggleable via `H` hotkey.
* [x] **Uniform Stealth Standard**: All masked figures render as invariant Unicode bullet sequences (`••••••`), backed by 300ms hover-to-reveal tooltips.
* [x] **GPU-Composited Tick Flashers**: Composited pseudo-elements (`::before`) with 0ms attack and 350ms decay, eliminating DOM reflows.
* [x] **3-Layer Design Token Architecture**: Primitives (`--ref-*`), Semantics (`--sys-*`), and Views (`main.css`, `matrix.css`, `positions.css`) with Universal CVD Cyan/Amber colorway.
* [x] **Zero-Latency Telemetry Micro-Popovers**: `.adr-cell-wrapper` with `pointer-events: none` on floating cards to eliminate hover flickering and accidental order interception.

### 4. 📊 Portfolio Telemetry, Volatility & Mathematical Parity
* [x] **Session ADR Exhaustion Micro-Gauges**: Real-time session extremes ($\text{Range}_{\text{today}}$), session absorption %, and directional room (up/down) streamed in 500ms frames with 3-state chromatic tokens.
* [x] **Class-Internal Dual-Buffer Sparklines**: [`CircularPriceBuffer`](./frontend/src/utils/sparklineBuffer.ts) managing pre-allocated `Float32Array(120)` ring and render buffers with zero heap allocations on incoming ticks.
* [x] **Total Portfolio Heat Gauge**: Real-time aggregation of open stop-loss risk in dollars, account equity %, and $R$-multiples.
* [x] **Net Currency Exposure Breakdown**: Directional base/quote exposure vectors (`+1.00 EUR`, `-0.50 USD`) with broker suffix stripping.
* [x] **Conservative Volume Stepping Parity**: Enforces $\lfloor \frac{\text{Exact Lot}}{\text{Volume Step}} + 10^{-9} \rfloor \times \text{Volume Step}$ identically across TypeScript and Python, ensuring risk is a strict ceiling.
* [x] **Frontend Quantitative Math Test Suites**: 75 passing Vitest unit tests covering lot calculations, 4-way position math, sparkline buffers, and portfolio heat.

