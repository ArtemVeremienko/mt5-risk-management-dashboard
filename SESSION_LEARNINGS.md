# 🧠 SESSION_LEARNINGS.md — Technical Retrospective & Gotchas

> **Scope**: Concrete architectural insights, runtime traps, API nuances, and negative knowledge extracted during the Phase 3 backend refactoring, domain model unification, and browser verification.

---

## 🏛️ 1. System & Architectural Insights

### The "Compatibility Facade" Anti-Pattern in Internal Monorepos
* **Observation**: In earlier iterations, `feed.py` defined `MT5RiskFeed(MT5NativeProvider)` and overrode provider methods (`get_account_summary`, `get_market_symbols`, `get_open_positions`) to return `.model_dump()` dictionaries under the rationale of "preserving legacy backward-compatibility."
* **Impact**: This broke the Liskov Substitution Principle and violated the `IMarketDataProvider` interface contract. Application services expecting `AccountState` received `dict`, leading to `AttributeError: 'dict' object has no attribute 'leverage'`. Developers then introduced defensive duck-typing (`hasattr(s, "model_dump")`, `symbol = spec.symbol if hasattr(spec, "symbol") else spec["symbol"]`), degrading the codebase.
* **Architectural Rule**: In an internal monorepo where you control both the callers (routers/services) and the tests, **never build compatibility facades that downgrade domain entities to raw primitives**. Update the few test assertions to use typed attribute access instead of polluting domain layers with dict-emulation hacks.

### Provider Singleton Coupling in Application Factories
* **Observation**: `app.py` maintained a module singleton `feed = MT5RiskFeed()`, but `create_app()` executed:
  ```python
  prov = market_provider or (market_service.provider if market_service else (MockDataProvider() if app_settings.mock_mode else MT5NativeProvider()))
  ```
* **Impact**: `create_app()` instantiated a second, detached `MT5NativeProvider` instance. When unit tests did `from app import feed; monkeypatch.setattr(feed, "send_market_order", ...)`, the FastAPI routes invoked `app.state.execution_service`, which held the second provider instance. The monkeypatch was completely ignored, and the test sent real orders to the MT5 terminal (failing with `retcode: 10027 AutoTrading Disabled`).
* **Architectural Rule**: If an application supports a module-level singleton facade for tests or scripts, the factory `create_app()` must default to that exact singleton instance (`... else feed`), rather than creating duplicate instances.

---

## 🪤 2. Gotchas, Traps & Framework Quirks

### WebSocket Silent Hangs via Unhandled Endpoint Exceptions
* **Gotcha**: When a client connected to `/ws/live`, the initial data payload was prepared inside a `try:` block:
  ```python
  symbols = await market_service.get_market_symbols()
  account = await market_service.get_account_summary()
  await websocket.send_json({"account": account.model_dump(), ...})
  ```
  When `account` was unexpectedly a `dict`, `account.model_dump()` raised `AttributeError`. The route caught this in a broad `except Exception:` block and exited to `finally: await manager.disconnect(websocket)`.
* **Trap**: The client test (`client.websocket_connect("/ws/live")`) was executing `data = websocket.receive_json()`. Because the server failed before sending the initial frame and closed without an HTTP error status, `receive_json()` hung indefinitely, blocking the entire test runner.
* **Remedy**: Ensure typed models are strictly enforced at service boundaries so serialization never raises runtime attribute errors. When testing WebSockets, always wrap receive calls in a timeout.

### Pydantic v2 `ConfigDict` Inheritance and Name Resolution
* **Gotcha**: A base class `DomainModel(BaseModel)` defined `model_config = ConfigDict(frozen=True)`. When refactoring a subclass (e.g. `SampleSizeInfo`), removing unused imports resulted in `NameError: name 'ConfigDict' is not defined` during pytest test collection because the subclass explicitly redeclared `model_config = ConfigDict(frozen=True, arbitrary_types_allowed=True)`.
* **Remedy**: Pydantic v2 models automatically inherit `model_config` from parent classes. Subclasses only need to declare `model_config` if they extend or override configuration (e.g. `arbitrary_types_allowed=True`), in which case `from pydantic import ConfigDict` must be explicitly imported in that module.

### Chrome DevTools Protocol (CDP) WebSocket Bypass on Chrome 128+
* **Gotcha**: On modern Google Chrome releases, HTTP endpoints on the remote debugging port (`http://127.0.0.1:9222/json/list` and `/json/version`) return `HTTP 404: Not Found` unless `--remote-allow-origins=*` is explicitly passed on the command line.
* **Workaround**: Chrome still writes the active port and the raw browser target WebSocket URI to:
  ```
  %LOCALAPPDATA%\Google\Chrome\User Data\DevToolsActivePort
  ```
  Line 1 contains the port (e.g. `9222`), and Line 2 contains the browser target path (e.g. `/devtools/browser/061bda37-...`). Connecting directly via WebSocket (`ws://127.0.0.1:9222/devtools/browser/...`) bypasses the HTTP 404 restriction, allowing target creation (`Target.createTarget`), session attachment (`Target.attachToTarget`), and full automated screenshot capture (`Page.captureScreenshot`).

---

## 🌐 3. Domain & API Nuances

### Pydantic `Field()` vs. Clean Type Annotations
* **Nuance**: Why some models use `Field(...)` while others do not:
  * **API Request/Response DTOs** (`AccountState`, `Position`, `OrderExecuteRequest`): Use `Field(description="...", ge=..., gt=...)` to generate rich OpenAPI/Swagger documentation for the frontend and API consumers.
  * **Quantitative Domain Entities & Value Objects** (`SymbolSpec`, `MarginSpecs`, `BreakEvenInputs`): Plain Python type hints (`bid: float`, `digits: int`, `point: float = 0.00001`) are preferred. They eliminate 30+ lines of redundant `Field(...)` boilerplate without losing validation or IDE autocomplete.
* **Sensible Domain Defaults**: Models like `SymbolSpec` previously required 15+ numeric parameters to instantiate, making tests verbose. Providing sensible defaults (`pip_size=0.0001`, `contract_size=100000.0`, `volume_min=0.01`, etc.) allows unit tests and calculations to instantiate instances cleanly:
  ```python
  spec = SymbolSpec(symbol="EURUSD", adr_14_pips=80.0, atr_14_pips=85.0)
  ```

---

## 🚫 4. Negative Knowledge (What NOT to Do)

1. **DO NOT implement dictionary subscripting (`__getitem__`, `__contains__`, `get`) on Domain Models**:
   - *Why*: Pretending that a Pydantic domain model is a `dict` obscures type errors, hides bugs during refactoring, and encourages developers to write `isinstance(x, dict)` or `hasattr(x, "field")` branches in business logic.
2. **DO NOT convert models to dicts within application or infrastructure providers**:
   - *Why*: Converting to dicts destroys type safety. Serialization to dictionaries (`model_dump()`) belongs exclusively at the network presentation boundary (`routers/` or `websocket/`).
3. **DO NOT shut down shared background executors in temporary test lifespans**:
   - *Why*: If a test initializes FastAPI `TestClient(app)` as a context manager and the app lifespan calls `feed.shutdown()`, any singleton `ThreadPoolExecutor` embedded in `feed` is terminated. Subsequent tests in the suite attempting to use `feed` fail with `RuntimeError: cannot schedule new futures after shutdown`.

---

## 📏 5. Reusable Conventions & Rules

1. **Strict Layer Boundary Serialization**:
   - `domain/`: Pure Pydantic models (`DomainModel`) and mathematical functions. Zero serialization logic.
   - `infrastructure/providers/`: Implements provider interfaces (`IMarketDataProvider`, `IExecutionProvider`). Always returns typed domain models (`AccountState`, `SymbolSpec`, `Position`).
   - `application/`: Orchestrates domain models and providers. Always consumes and produces typed models.
   - `presentation/`: Only routers and WebSocket emitters are permitted to call `.model_dump()` immediately before network transmission.
2. **Attribute Access Only**:
   - All tests and domain services must access model fields via dot-notation (`pos.r_multiple`, `sym.adr_14_pips`). Never use `pos["r_multiple"]`.
3. **Selective `Field()` Usage**:
   - Use `Field(description=...)` exclusively on user-facing DTOs or when numerical constraints (`gt=0`, `le=1.0`) or default factories (`default_factory=list`) are strictly needed. Use plain type hints for pure computational domain objects.

---

## ⚡ 6. MT5 Concurrency & Market Watch Nuances (Session Update)

### Worker Lock Deadlock on Startup
* **Gotcha**: Holding `with self._mt5_lock:` on the main/caller thread while dispatching work to `MT5IPCWorker.call()` creates a classic mutex deadlock. The worker thread's guarded execution requires `self._lock`, but the caller thread is synchronously awaiting the future result while holding that exact lock.
* **Impact**: The call timed out after 5.0 seconds (`MT5IPCTimeoutError`), causing `_init_mt5()` to catch the exception and silently degrade to `MockDataProvider` (`self._mock_mode = True`).
* **Remedy**: Never acquire the IPC worker lock on the caller thread. Dispatch initialization logic directly onto the dedicated worker thread via `self._ipc_worker.call(self._init_mt5_sync)`.

### MetaTrader 5 Symbol Discovery: `select` vs. `visible`
* **Nuance**: `MetaTrader5.symbols_get()` returns all broker symbols. Each `SymbolInfo` contains two flags:
  * `symbol.select`: True if the symbol is in the terminal's internal subscription cache (e.g. opened in background charts or previously added; 48 symbols).
  * `symbol.visible`: True **only** if the symbol is actively shown in the user's Market Watch window (`25 / 2105` symbols).
* **Remedy**: In `_sync_market_watch_symbols()`, filter strictly by `getattr(s, "visible", False)` to keep the screener synchronized with the trader's actual active Market Watch.

---

## 🎯 7. Dual-Arm Execution, Invariant Hitbox Ergonomics & Smart Liquidation

### System & Architectural Insights
* **Fitts's Law & Hitbox Invariance in High-Density Financial Matrices**:
  * **Observation**: When implementing the 5-state execution engine, initial prototypes expanded the button width (e.g. from `58px` at rest to `102px` when armed with label `CONFIRM SELL`).
  * **Impact**: In a flex table cell, this dynamically pushed the neighboring button (`BUY`), shifting the operator's physical click target under their mouse while they were preparing to confirm. It also triggered table column resizing and cell-wide visual jitter.
  * **Architectural Rule**: Execution controls in high-frequency trading matrices must have **strictly invariant geometry** (`width: 64px; min-width: 64px; max-width: 64px; height: 30px`) inside a fixed-width container (`136px`). State transitions (Resting $\to$ Armed $\to$ In-Flight $\to$ Fill) must be communicated solely through border glows, a 2px hairline dwell countdown bar along the bottom edge, and centered glyphs (`✓`/`✕`), never by altering element dimensions or expanding label strings.
* **Documentation-Codebase Synchronization Drift**:
  * **Observation**: Roadmap documents (`TODO.md`, `BACKEND_REFACTORING_PLAN.md`) lagged behind the codebase: Phase 4 backend features (`LiquidationService`, `PreTradeGatekeeper`, Session ADR streaming) had already been implemented and unit-tested in earlier sessions, but remained marked unchecked (`[ ]`).
  * **Architectural Rule**: Always perform an AST or codebase symbol scan (`grep_search`) before beginning tasks described as "pending" in roadmaps. Never assume roadmap markdown checkboxes reflect code reality.

### Gotchas, Traps & Framework Quirks
* **The "Dimmed Opposing Button Lockout" Trap**:
  * **Gotcha**: When `BUY` was armed, setting `pointer-events: none` on the un-armed `SELL` button trapped the operator if market momentum abruptly reversed. The trader had to either wait 5.0 seconds for the timer to expire or reach for the `Escape` key.
  * **Remedy**: Keep the opposing button interactive (`pointer-events: auto`) while dimming it (`opacity: 0.35; filter: grayscale(0.4)`). Implement an **Instant Pivot** in the click handler: clicking the opposing button immediately disarms the first direction and arms the second in a single gesture.
* **Pytest Collection Order & Fixture Interference**:
  * **Gotcha**: Running `pytest tests test_risk_calculator.py` inverted collection order compared to standard `pytest test_risk_calculator.py tests`. When `tests/unit` ran first, certain FastAPI `TestClient` lifespans initialized background thread pools that could collide with singleton references if executors were improperly shared.
  * **Remedy**: Standardize test invocation strictly on the root `pyproject.toml` configuration (`uv run pytest`) rather than passing arbitrary command-line path permutations that shuffle collection order.

### Domain & API Nuances
* **Cognitive Asymmetry: Fill (400ms) vs. Rejection Dwell Time**:
  * **Nuance**: When an order fills (`✓`), the outcome is expected and confirmation should return to resting quickly (**400ms**) to keep the terminal responsive. Conversely, an order rejection (`✕`) is an unexpected operational anomaly (e.g. spread blowout, volume step misalignment, margin breach). Because an involuntary eye blink lasts 100–400ms, a 400ms rejection flash can be completely missed, leaving the operator confused as to whether the order was routed.
  * **Design Principle**: Rejection feedback requires longer visual dwell time (or an accompanying tactile shake / persistent toast) than success confirmation to ensure human cognitive acknowledgment.
* **Two-Phase Smart Flatten ($0.00 Net Delta) vs. Position Liquidation**:
  * **Nuance**: Standard MT5 `positions_get()` only returns open market deals. If an operator has active pending orders (`orders_get`: Buy Stops, Sell Limits, Trailing entries), a standard "Close All" leaves those orders live in the order book. Subsequent market movements can trigger fills, re-exposing the account.
  * **Rule**: Institutional flattening must execute a two-phase atomic sequence: **Phase 1** cancel 100% of pending orders (`TRADE_ACTION_REMOVE`), **Phase 2** liquidate 100% of open positions (`TRADE_ACTION_DEAL`).

### Negative Knowledge (What NOT to Do)
1. **DO NOT dynamically expand execution button widths on state transitions in data grids**:
   - *Why*: Resizing buttons violates Fitts's Law, moves the hitbox under the operator's cursor, and causes layout thrashing across the table row.
2. **DO NOT lock out or disable the opposing direction button during an armed countdown**:
   - *Why*: Disabling the opposing button locks the trader out of rapidly pivoting direction when market conditions change.
3. **DO NOT equate closing market positions with achieving $0.00 net delta**:
   - *Why*: Leaving pending orders in the book risks latent execution post-liquidation. Always purge pending orders first.

### Reusable Conventions & Rules
1. **Strict Invariant Hitbox Rule**:
   - All trade execution triggers in tabular views must declare identical fixed `width`, `min-width`, and `max-width` (e.g. `64px`), and flex button groups must have a locked total width (e.g. `136px`). State changes must be conveyed purely via color, border, hairline progress indicators, and glyphs.
2. **Instant Pivot Execution Contract**:
   - In any multi-action dual-arm safety system, the un-armed opposing action must remain clickable to allow instant 1-click direction flipping.
3. **Two-Phase Liquidation Sequence**:
   - Emergency account liquidation routines must always execute: `cancel_all_orders()` $\to$ `close_all_positions()`.

---

## 🛡️ 8. Cognitive Ergonomics & Emergency Liquidation Control Patterns

### System & Architectural Insights
* **The "Mode Switch on Emergency Controls" Anti-Pattern**:
  * **Observation**: Providing a segmented switch (`Close Pos` vs. `Flatten ($0 Δ)`) directly adjacent to an emergency liquidation trigger was intended to give user flexibility, but in practice consumed excessive toolbar width (~140px) and forced an unnatural cognitive choice.
  * **Impact**: During emergency market conditions (flash crashes, economic spikes, runaway drawdowns), Easterbrook’s Hypothesis dictates acute **attentional narrowing** and prefrontal cortex inhibition. Forcing a trader to choose between two adjacent modes introduces friction and decision paralysis at the exact moment zero-latency certainty is needed.
  * **Architectural Rule**: Per [`docs/01_institutional_terminal_design.md`](./docs/01_institutional_terminal_design.md), professional OMS terminals (Bloomberg AIM, TT, CQG) do not expose segmented mode toggles during panic exits. The emergency control must be a **single unified action**: **"Flatten All ($0 Δ)"** (Net Delta $\to 0.00$), protected by a two-phase 4-second safety arming countdown.

### Domain & API Nuances
* **Market-Order Invariance Under Smart Flatten**:
  * **Nuance**: For pure market traders with zero pending orders, `Flatten All` executes in identical latency to `Close All` (cancels 0 pending orders, closes all positions). However, when resting limit or breakout stop orders exist, standard "Close All" leaves them active in MT5, risking immediate re-exposure once the trader leaves the desk.
  * **Rule**: There is zero operational or execution penalty to always defaulting emergency liquidation to a two-phase smart flatten (`api.flattenAll()`).

### Negative Knowledge (What NOT to Do)
1. **DO NOT place mode-switching controls adjacent to high-consequence panic buttons**:
   - *Why*: In acute stress, fine motor control degrades and cognitive load spikes. Emergency buttons must have singular, unambiguous intent.
2. **DO NOT maintain dead store signals or UI preferences when an action can be consolidated**:
   - *Why*: Redundant signals (`emergencyActionMode`) in `preferencesStore` introduce dead code paths and unnecessary `localStorage` churn. Always purge unused signals when unifying domain actions.

---

## 👁️ 9. Cognitive Ergonomics, Stealth PnL & Hardware Tick Flasher Architecture

### System & Architectural Insights
* **The Normalizing Power of the $R$-Multiple HUD**:
  * **Observation**: In trading drawdowns, flashing negative dollar amounts ($-\$420.00$) triggers acute insula and amygdala activation, inducing the loss-aversion gamble ($\lambda \approx 2.25$) and revenge trading.
  * **Impact**: Normalizing the account PnL and blotter metrics to $R$-multiples relative to target risk ($-0.42R$) reframes market retracements as normal statistical variance within an expected distribution, mitigating cortisol spikes and premature stop relocation.
* **GPU-Composited Hardware Isolation for High-Frequency Streaming Quotes**:
  * **Observation**: Applying CSS background transitions directly to high-frequency text nodes (`<td>` or `.price-bid`) causes constant DOM style recalculations, paint invalidations, and potential layout thrashing across all table rows.
  * **Architectural Rule**: Per [`docs/01_institutional_terminal_design.md §5.3`](./docs/01_institutional_terminal_design.md), tick flasher components MUST use GPU-composited pseudo-elements (`::before`) with `opacity` decay and `transform: translateZ(0)` / `will-change: opacity`. This isolates repaints from the layout engine, achieving instant 0ms attack and smooth 350ms `cubic-bezier(0.16, 1, 0.3, 1)` decay without CPU reflows.

### Gotchas, Traps & Framework Quirks
* **Global Hotkey Focus Hijacking**:
  * **Gotcha**: A global hotkey (like `H` for Stealth mode) can accidentally intercept operator typing when they enter a symbol search or write into an inline SL/TP input box.
  * **Remedy**: Always guard keyboard event listeners by inspecting `document.activeElement`:
    ```typescript
    const isEditable = activeEl && (
      activeEl.tagName === 'INPUT' ||
      activeEl.tagName === 'TEXTAREA' ||
      activeEl.tagName === 'SELECT' ||
      (activeEl as HTMLElement).isContentEditable
    );
    if (isEditable) return;
    ```

### Reusable Conventions & Rules
1. **HTML Root Dynamic Colorway Contracting**:
   - To provide instantaneous, zero-re-render theme switching (such as Universal CVD Cyan/Amber), apply a declarative attribute on the root (`document.documentElement.setAttribute('data-colorway', val)`). CSS semantic tokens consume this attribute to remap variables cleanly across the entire DOM tree without component re-renders.
2. **Tabular Numbers Invariance**:
   - All monetary, pip, and $R$-multiple figures must strictly enforce `font-variant-numeric: tabular-nums` to prevent horizontal micro-jitter when numbers fluctuate between positive, negative, and masked states.

---

## 📈 10. Dual-Buffer Zero-Allocation Sparklines, Persistent Overrides & Portfolio Heat

### System & Architectural Insights
* **The "Caller-Allocated Buffer" Memory Leak Anti-Pattern**:
  * **Observation**: In early ring buffer prototypes, the data structure returned a newly instantiated array on each call (`createRenderBuffer(): Float32Array`), or required callers to pass their own destination buffers (`copyTo(dest)`).
  * **Impact**: In a high-frequency trading terminal with 26 instruments streaming at 500ms Turbo Mode ($52\text{ messages/sec}$), component-level array allocations create steady garbage collection pressure. Under Chrome or WebKit, periodic GC sweeps cause 15–30ms micro-stutters and frame drops during high-volatility tick bursts. Furthermore, requiring the component to manage buffer instances leaked capacity magic numbers (`120`) across multiple UI files.
  * **Architectural Rule**: Implement the **Class-Internal Dual-Buffer Pattern**. The buffer instance (`CircularPriceBuffer`) owns both the raw ring buffer (`rawBuffer: Float32Array(120)`) and the unrolled chronological buffer (`renderBuffer: Float32Array(120)`). When `getChronological(outMetrics)` is invoked, it unrolls into its internal `renderBuffer` and computes `min`, `max`, `first`, and `last` in a single contiguous memory sweep ($< 3\mu\text{s}$), writing results to a pre-allocated metrics object. Zero heap memory is allocated on tick arrival or render loops.
* **Canvas Rendering Budgeting via Pinned / Hovered Gating**:
  * **Observation**: Canvas repaints across 26 simultaneous table rows on every 500ms broadcast introduce significant GPU compositing overhead, even when price movement is minimal.
  * **Architectural Rule**: Separate **data ingestion** from **canvas rendering**. Ring buffers continuously ingest quotes in memory for all symbols ($O(1)$ updates). However, canvas `<canvas>` rendering and `requestAnimationFrame` hooks are strictly gated to rows that are **Pinned (`📌`)** or currently **Hovered**. Default unpinned rows remain dormant until inspected or pinned, keeping UI frame rate locked at 60 FPS ($< 0.05\text{ms}$ rendering overhead).

### Gotchas, Traps & Framework Quirks
* **Input Desynchronization vs. `isFocused` Shielding**:
  * **Gotcha**: In high-frequency 500ms streaming, if an inline Stop Loss input synchronizes reactively with incoming props or store signals, an active operator typing a replacement value (e.g. `35.0`) will have their typing interrupted or overwritten by the next tick.
  * **Remedy**: Always maintain a local signal (`localVal`) inside the row component paired with an `isFocused` flag. Synchronize external state changes to `localVal` strictly when `!isFocused()`. Provide `onFocus={(e) => e.currentTarget.select()}` for instant single-keystroke replacement.
* **Solid.js Store Initialization vs. Module Singleton Exports**:
  * **Gotcha**: When unit tests or subagents inspect browser state, referencing unexported stores or trying to inspect stores from the global `window` fails unless explicitly exposed or accessed through Solid's reactivity tree.
  * **Workaround**: Never rely on ad-hoc monkey-patching of stores on `window` in production code. Use standard typed services (`api.ts`, `wsService.ts`) and let Solid.js reactive signals propagate to the DOM, where end-to-end accessibility trees and data attributes can be inspected cleanly by testing agents.

### Domain & API Nuances
* **Normalized Portfolio Heat in Risk Multiples ($R$)**:
  * **Nuance**: In multi-position trading, raw dollar heat ($-\$1,250.00$) varies drastically depending on account size, whereas percentage heat ($12.5\%$) masks how many distinct risk units are at stake.
  * **Mathematical Formulation**: Define baseline $1R$ dollar risk as:
    $$1R = \text{Working Capital} \times \text{Risk \%} \quad (\text{e.g. } \$8,558.02 \times 0.01 = \$85.58)$$
    Portfolio Heat in $R$-multiples is then dynamically computed as:
    $$\text{Heat}_R = \frac{\text{Total Open Risk Dollars}}{1R} = \frac{\sum (\text{SL Risk Amount})}{1R}$$
    This allows a discretionary trader to immediately see that they are risking e.g. **$2.50R$ across 3 positions**, regardless of whether their PnL display is set to Currency, R-Multiple, or Stealth Mask mode.
* **Multi-Currency Directional Vector Deconstruction**:
  * **Nuance**: Direct lot volume summation across currency pairs is meaningless (e.g., $1.0$ lot EURUSD BUY vs. $1.0$ lot USDJPY BUY represents opposing dollar commitments, not additive risk).
  * **Rule**: To compute true directional exposure, deconstruct each symbol into base and quote components:
    * EURUSD BUY $0.50$ lots $\implies$ `+0.50 EUR`, `-0.50 USD`
    * GBPUSD SELL $0.30$ lots $\implies$ `-0.30 GBP`, `+0.30 USD`
    * Net Exposure: `+0.50 EUR`, `-0.30 GBP`, `-0.20 USD`.

### Negative Knowledge (What NOT to Do)
1. **DO NOT introduce floating hover preset chip popups (`[¼]`, `[⅓]`, etc.) in high-frequency tabular inputs**:
   - *Why*: Floating preset chips create visual clutter, obscure neighboring cells (Lot Size / Effective Risk), and trigger unintended clicks during rapid mouse navigation. A clean numeric input with instant select-on-focus and a persistent `localStorage` override mechanism is vastly superior for discretionary intraday execution.
2. **DO NOT re-allocate typed arrays inside component render loops**:
   - *Why*: Instantiating `new Float32Array()` or `.slice()` in 500ms intervals triggers unavoidable garbage collector pauses. Always pre-allocate fixed-size buffers inside utility classes.
3. **DO NOT mask the risk percentage when Stealth Mask mode is active**:
   - *Why*: Stealth mode is designed to eliminate emotional bias caused by large floating dollar numbers, **not** to obscure account risk. The percentage of Working Capital (`(1.6% of WC)`) must remain visible at all times to maintain pre-trade safety awareness.

### Reusable Conventions & Rules
1. **Dual-Buffer Utility Encapsulation**:
   - Any time-series visualization utility requiring unrolling or normalization must manage both ring buffer and render buffer internally. The caller must only request a read view (`getChronological()`).
2. **Persistent Custom Overrides Contract**:
   - Symbol-specific parameter overrides (such as custom Stop Loss points) must be persisted in `localStorage` under namespaced keys (e.g. `mt5_sl_overrides`) and paired with an unambiguous reset affordance (`↺`) that removes the key and immediately restores the global rule.
3. **Multi-Mode Value Formatting Hierarchy**:
   - Any telemetry metric reflecting PnL or risk must strictly respect the global `pnlDisplayMode`:
     - `currency`: `$X,XXX.XX`
     - `r_multiple`: `+X.XX R` / `-X.XX R`
     - `stealth_mask`: `***.**` (preserving sign indicator where applicable)

---

## ⚡ 11. Conservative Risk Ceilings, Pure HTTP Abstractions & Frontend Test Architecture

### System & Architectural Insights
* **The "Risk As Strict Ceiling" Imperative (Conservative Volume Stepping)**:
  * **Observation**: In standard mathematical rounding (`Math.round(exact_lot / volume_step)`), half-steps round upward. For example, if an account's target risk budget dictates an exact lot of `0.017` with a broker volume step of `0.01`, rounding up yields `0.02` lots ($+17.6\%$ risk overshoot). In prop firm evaluations (FTMO, Topstep) and strict quantitative risk management, target risk percentage is a **strict ceiling**, never a target average.
  * **Architectural Rule**: Sizing engines must strictly enforce conservative stepping via flooring:
    $$\text{Stepped Lot} = \lfloor \frac{\text{Exact Lot}}{\text{Volume Step}} + \epsilon \rfloor \times \text{Volume Step}$$
    This mathematically guarantees that $\text{Effective Risk} \le \text{Target Risk}$ across all instruments, ensuring zero accidental drawdown breaches.
* **Full-Stack Mathematical Parity**:
  * **Observation**: Calculating lot sizes on the client in TypeScript (`lotCalculator.ts`) and validating them on the backend in Python (`domain/math/risk_models.py`) creates a high risk of calculation divergence if stepping algorithms differ.
  * **Architectural Rule**: Any change to pre-trade math (rounding vs flooring, step calculations, margin engines) must be synchronized synchronously across both TypeScript and Python with identical unit test assertions.
* **Transport Failure vs. Domain Operation Outcome**:
  * **Observation**: In trading terminals, a distinction exists between **transport/infrastructure failures** (network offline, 502 Bad Gateway, 500 internal server error) and **domain business outcomes** (broker reject, spread blowout guard, margin check failure).
  * **Architectural Rule**:
    * **Queries** (`fetchAccount`, `fetchPositions`) throw `ApiError` on HTTP failure to let UI layers trigger fallback/offline states.
    * **Mutations/Orders** (`executeOrder`, `closePosition`, `modifyPosition`) return typed domain results `{ success: boolean, message: string }`. If a catastrophic transport failure or HTTP 5xx occurs, `api.ts` traps the `ApiError` and synthesizes `{ success: false, message: err.message }`. This guarantees that execution buttons and click handlers **never** encounter unhandled promise rejections or crash the Solid.js reactive tree.

### Gotchas, Traps & Framework Quirks
* **IEEE-754 Epsilon Trap in Conservative Flooring**:
  * **Gotcha**: Using raw `Math.floor(exactLot / volumeStep)` without an epsilon causes severe binary representation bugs:
    `Math.floor(0.03 / 0.01)` in JavaScript can evaluate as `Math.floor(2.9999999999999995) = 2` (`0.02` lots instead of `0.03`).
  * **Remedy**: Always add a floating-point epsilon ($10^{-9}$):
    ```typescript
    const steps = Math.floor(exactLot / volumeStep + 1e-9);
    ```
    Similarly, in Python:
    ```python
    steps = math.floor(exact_lot / volume_step + 1e-9)
    ```
* **Vite / Vitest Environment Dependencies**:
  * **Gotcha**: Adding `vitest` to a Solid.js/Vite project without an explicit DOM environment triggers `Error: Cannot find package 'jsdom'` during worker initialization when testing components or APIs that rely on `Headers`, `FormData`, or `window`.
  * **Remedy**: Always install `jsdom` alongside `vitest` in `devDependencies` (`npm i -D vitest jsdom`) to provide standard web API primitives in test workers.
* **FormData Multi-part Content-Type Header Stripping**:
  * **Gotcha**: Setting `headers.set('Content-Type', 'application/json')` globally or forgetting to omit it on `FormData` uploads breaks `multipart/form-data` requests. Browsers and `fetch` polyfills require the `Content-Type` header to be unset so the runtime can auto-generate the boundary string (e.g. `multipart/form-data; boundary=----WebKitFormBoundary...`).
  * **Remedy**: In generic HTTP clients, explicitly check `!(body instanceof FormData)` before applying default content headers:
    ```typescript
    if (body !== undefined && !(body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    ```

### Domain & API Nuances
* **FastAPI Error Payload Polymorphism**:
  * **Nuance**: FastAPI returns different JSON error structures depending on how an exception was raised:
    1. Standard `HTTPException(detail="...")`: `{ "detail": "Position not found" }`
    2. Pydantic request validation error (`422`): `{ "detail": [{ "loc": ["body", "volume"], "msg": "field required" }] }`
    3. Custom broker exceptions: `{ "error": "Spread blowout" }` or `{ "message": "Invalid action" }`
  * **Rule**: A resilient API client must extract error messages hierarchically:
    1. `data.message`
    2. `data.error`
    3. `data.detail` (if string)
    4. `data.detail[0].msg` (if array, formatted with field path `field: message`)
    5. Fallback to `res.statusText` or `HTTP error {status}`.

### Negative Knowledge (What NOT to Do)
1. **DO NOT use `Math.round` for lot volume stepping in pre-trade sizing**:
   - *Why*: Rounding up increases position volume past the trader's explicit risk percentage, risking instant disqualification in funded trader accounts.
2. **DO NOT pull heavy third-party HTTP client libraries (`axios`, `ky`) into lightweight Solid.js SPAs**:
   - *Why*: An institutional-grade HTTP client with JSON serialization, timeout abortion, error extraction, and verb helpers requires only ~60 lines of native TypeScript. Third-party packages add dependency bloat, security audit overhead, and versioning churn without added utility.
3. **DO NOT allow trade execution catch blocks to leak unhandled promise rejections**:
   - *Why*: UI order buttons wired to async functions that throw unhandled errors leave buttons in a disabled or permanent loading state if a network disconnect occurs mid-flight.

### Reusable Conventions & Rules
1. **Epsilon-Protected Stepping Invariant**:
   - Any volume or tick stepping calculation using flooring must use `+ 1e-9` prior to flooring: `floor(val / step + 1e-9) * step`.
2. **Safe Order Mutation Contract**:
   - All mutation endpoints in `api.ts` must return `Promise<OrderActionResult>` with `{ success: boolean, message: string }`, catching underlying `ApiError` exceptions and translating them into user-facing failure records.
3. **Automated Frontend Regression Testing**:
   - Every service or utility refactoring must be accompanied by Vitest unit tests in `src/services/*.test.ts` or `src/utils/*.test.ts`, verified via `npm test` and `npm run typecheck` before committing.

---

## 12. Micro-Sparkline Psychophysics, Retina DPI Calibration & Grid Ergonomics

### System & Architectural Insights
* **Slope Distortion Index in Financial Sparklines**:
  * *Insight*: As formalized in quantitative terminal ergonomics (`docs/02 §3`), the visual slope $\theta$ of a sparkline series $P_t$ in a canvas of dimensions $(W, H)$ is:
    $$\theta \propto \arctan\left(\frac{\Delta P / \sigma_P}{W / N}\right)$$
  * *Problem*: In an excessively narrow sparkline ($46\text{px} \times 18\text{px}$ rendering a 120-point ring buffer), the horizontal pitch is only $0.38\text{px/tick}$. A standard 1–2 pip Brownian noise fluctuation in tight consolidation produces steep optical slopes exceeding $65^\circ$. This creates an artificial perception of explosive volatility ("slope distortion"), inducing premature trader panic, impulsive market orders, and cognitive fatigue.
  * *Solution*: Expanding the aspect ratio to $3.0:1$ ($60\text{px} \times 20\text{px}$) with an effective window width increases horizontal pitch to $0.504\text{px/tick}$. This dampens micro-noise jitter below the perceptual panic threshold while clearly rendering genuine directional momentum and range breakout regimes.

* **Gestalt Law of Proximity vs Elastic `space-between` Flex Layouts**:
  * *Problem*: Positioning the sparkline ribbon on the left edge and market bid/ask prices on the right edge via `justify-content: space-between` inside a fixed $175\text{px}$ column caused an erratic floating whitespace gap ($30\text{px}$ to $180\text{px}$) across symbols with differing price digit counts (e.g., `BITCOIN 79764.44` vs `NAT.GAS 2.992`). The human eye had to jump across fluctuating voids to correlate the micro-trend with the current price, violating Gestalt visual grouping.
  * *Solution*: Anchoring both the sparkline and price cluster to the right edge (`justify-content: flex-end; gap: 10px`) enforces an invariant spatial relationship. The sparkline ribbon and stacked bid/ask act as a single, coherent perceptual telemetry unit, with prices aligning neatly along their right decimal baseline.

### Gotchas, Traps & Framework Quirks
* **Canvas Sub-Pixel Blur on High-DPI / Retina Displays**:
  * *Trap*: Setting `<canvas width={60} height={20} />` and rendering lines with `ctx.lineWidth = 1.2` creates blurry, washed-out anti-aliasing on modern $125\%$, $150\%$, and $200\%$ ($2\times$) screens. The physical canvas backing-store buffer remains $60 \times 20$ device-independent pixels stretched over $120 \times 40$ physical hardware pixels.
  * *Fix*: Implement backing-store pixel ratio scaling inside the component mount lifecycle:
    ```typescript
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);
    ```
    This guarantees 1:1 hardware pixel crispness for sparkline strokes and live edge pulse dots across all display densities.

* **Fitts's Law Invariant vs CSS Grid Auto-Squeeze**:
  * *Trap*: The execution button cluster consists of two invariant triggers: `[ BUY ]` ($64\text{px}$) + `gap: 8px` + `[ SELL ]` ($64\text{px}$) = $136\text{px}$ minimum width. In a standard table cell with $16\text{px}$ padding on each side ($32\text{px}$ total), the column requires at least $168\text{px}$ ($136 + 32$). Allocating only $140\text{px}$ caused CSS table layout engines to unpredictably squeeze or clip the cell on compact displays.
  * *Fix*: Expand the `Execute` column to $170\text{px}$, providing full breathing room for the invariant buttons and hover glow halos.

### Reusable Conventions & Rules
1. **Harmonized 7-Column Screener Table Schedule ($1040\text{px}$ Baseline)**:
   * Symbol: `165px`
   * Market Price (Spread): `190px` (accommodates $60\text{px}$ sparkline + $10\text{px}$ gap + multi-digit price block)
   * 14D ADR: `110px`
   * Stop Loss: `120px` (accommodates $76\text{px}$ input + reset badge + labels)
   * Lot Size: `115px`
   * Effective Risk (Margin): `170px`
   * Execute: `170px`
2. **Viewport Eye Drift Containment**:
   * All primary screener grid wrappers (`.matrix-section`) must be constrained with `max-width: 1440px; margin: 0 auto; width: 100%;` to eliminate horizontal eye strain and excessive saccadic motion on $2560\text{px}$ or $3840\text{px}$ ultra-wide monitors.

---

## 13. Cognitive De-Biasing, Van Tharp R-Normalization & Popover Ergonomics

### System & Architectural Insights
* **The "Collateral vs Downside Risk" Categorical Error (Margin in R is an Anti-Pattern)**:
  * *Insight*: Downside risk (Stop Loss distance $\times$ lot size $\times$ pip value) and collateral requirement (Required Margin) belong to fundamentally separate financial domains.
  * *Trap*: Attempting to express Required Margin in $R$-multiples (e.g. `Margin: 2330.0 R` on Bitcoin or low-leverage crypto) breaks quantitative intuition. Margin is temporary locked equity returned upon trade closure; Stop Loss is unrecoverable capital destruction. Displaying margin in $R$ induces severe operator panic and cognitive distortion.
  * *Architectural Rule*: Downside Risk is strictly normalized in **Van Tharp $R$-multiples** ($R_{\text{loss}} = \frac{\text{Loss}}{\text{1R Cash}}$), whereas Margin Collateral is strictly rendered as **$\%$ of Deposited Account Equity** (`Margin: 0.4%`).

* **Two-Line Tabular Telemetry Invariant for Screener & Blotter Cells**:
  * *Insight*: Financial operators require simultaneous awareness of technical chart geometry (price levels) and risk magnitude without visual clutter.
  * *Pattern*: In both the Risk Screener and Positions Blotter, dedicate cell rows to a strict 2-line visual hierarchy:
    * **Line 1 (Geometry)**: Absolute broker price level (`1.08450`), formatted strictly to instrument digits.
    * **Line 2 (Telemetry)**: Single contextual metric driven by active display mode:
      * `currency`: `-$83.05` / `+$166.10`
      * `r_multiple`: `-0.97 R` / `+1.94 R`
      * `stealth_mask`: technical distance `-25.0 p` / `+50.0 p` (zero dollar anchor)
    * **Hover Tooltip**: Complete 3D inspection breakdown on demand (`Stop Loss: 1.08450 | -25.0 p | -$83.05 (-0.97 R)`).

### Gotchas, Traps & Framework Quirks
* **Global Hotkey Double-Dispatch via Redundant Window Listeners**:
  * *Trap*: Registering keydown listeners in both the root application shell (`App.tsx`) and an embedded layout component (`HeaderMetricsBar.tsx`) without coordinating handlers causes identical events (`'h'` / `'H'`) to fire twice synchronously on a single physical keystroke.
  * *Symptom*: Cycling state machines (e.g., `currency` $\rightarrow$ `r_multiple` $\rightarrow$ `stealth_mask` $\rightarrow$ `currency`) advance two steps per keypress, effectively making `r_multiple` completely unreachable when toggled via keyboard.
  * *Fix*: Consolidate UI mode hotkeys strictly into the owning component (`HeaderMetricsBar.tsx`), checking `activeElement` against editable inputs (`INPUT`, `TEXTAREA`, `contentEditable`), and remove redundant listeners from `App.tsx`.

* **Copy-Paste Telemetry Logic in Reactive Signals**:
  * *Trap*: When generating a memoized header metric (e.g. `formattedHeaderEquity`), copying floating P&L logic resulted in `EQ` displaying `+0.54 R` instead of the account's actual net equity. In a $10,000 account with -$50 floating P&L, seeing `P&L: -0.50 R | EQ: -0.50 R` was confusing and mathematically wrong.
  * *Fix*: In de-biased modes (`r_multiple` and `stealth_mask`), mask both `BAL`, `FREE`, and `EQ` consistently with uniform bullet characters (`••••••`), backed by a 300ms hover-to-reveal tooltip displaying the live dollar equity for operator verification.

* **Grid Label Clipping on High-DPI Windows Sub-Pixel Typography**:
  * *Trap*: Fixed grid template columns (`grid-template-columns: 58px 1fr;`) for stacked form tiers inside popovers (e.g. `SltpEditHub.tsx`) clipped labels with longer suffixes (e.g., `LOSS (-0.97` or `PROFIT (R)`). On Windows with ClearType or 125% DPI scaling, font glyphs expand by 1.1–1.3x.
  * *Fix*: Allocate minimum `72px 1fr` for tier label columns, pairing with `text-transform: uppercase; white-space: nowrap;` to guarantee zero truncation and zero unexpected line wraps.

### Domain & API Nuances
* **Van Tharp 1R Baseline Resolution Order**:
  * The dollar value of $1R$ is resolved reactively via `positionsStore.oneRCash()`:
    $$1R_{\text{cash}} = \text{Working Capital} \times \frac{\text{Target Risk \%}}{100}$$
  * If Working Capital is zero or uninitialized during initial connection boots, fallback strictly to `$100.00` (or `1.0`) to avoid `NaN`, `Infinity`, or zero-division crashes across client-side mathematical calculations.

* **Bidirectional 4-Way Order Management Synchronization**:
  * In `SltpEditHub.tsx`, modifying any one parameter must immediately update the other three without cyclical feedback jitter:
    $$\text{Price} \longleftrightarrow \text{Pips} \longleftrightarrow \text{Cash (\$)} \longleftrightarrow \text{R-Multiple (R)}$$
  * When editing in `r_multiple` mode, the user types directly in $R$-units (`-1.00 R`, `+2.00 R`). The calculation chain is:
    $$\text{Cash Loss} = -|R| \times 1R_{\text{cash}} \quad \longrightarrow \quad \Delta\text{Pips} = \frac{|\text{Cash Loss}|}{\text{Volume} \times \text{PipValue}} \quad \longrightarrow \quad \text{Price} = \text{OpenPrice} \pm (\Delta\text{Pips} \times \text{PipSize})$$
  * Always pass the instrument's exact `digits` to `toFixed(digits)` to prevent broker reject code `10015 (Invalid Price)`.

### Negative Knowledge (What NOT to Do)
1. **DO NOT retain raw fiat dollar amounts in deep-dive summary cards or pre-trade modals during de-biased sessions**:
   - *Why*: Showing masked or normalized units on the main grid while displaying raw dollars (`Target Risk: $85.51`) inside deep-dive modals completely breaks the psychological de-biasing shield and re-triggers loss aversion anchors.
2. **DO NOT mix disparate masking glyphs across the terminal**:
   - *Why*: Mixing `$••••••` on balances with `***.**` on equity and `***` on pills creates visual noise and looks like a rendering bug. Standardize on clean Unicode bullets (`••••••`) across all masked fields without currency prefixes.
3. **DO NOT use `1/2 ADR` as a primary intraday Stop Loss preset**:
   - *Why*: For high-volatility intraday trading (FX, Gold, Crypto), $0.5 \times \text{ADR}$ is excessively wide ($40\text{--}80\text{ pips}$), reducing volume capacity and forcing massive dollar commitments. Replace with a 1-click snap to `🎯 1.0 R` baseline risk.

### Reusable Conventions & Rules
1. **Uniform Stealth Standard (Option A)**:
   - When `pnlDisplayMode === 'stealth_mask'`, all financial magnitudes (BAL, WC, FREE, EQ, P&L, Heat) must render as invariant Unicode bullet sequences (`••••••`), with points/pips displayed as `(•••• p)`.
   - Never prefix masked bullets with currency symbols (`$••••••` $\rightarrow$ `••••••`).
2. **300ms Native Tooltip Inspection Contract**:
   - Any metric masked for de-biasing or stealth privacy must provide an unmasked native `title` attribute, enabling quick, intentional hover-to-reveal without persisting visual anchors on screen or in recordings.
3. **1-Click Baseline Snap Chip**:
   - All SL/TP editing surfaces must include an explicit `🎯 1.0 R` preset chip that automatically pins the stop loss distance to the account's configured mathematical unit of risk ($1.00 R$).

---

## 14. Rich Telemetry Hover Cards, Table Cell Overflow Stacking, and Zero-Flicker Micro-Popovers

### System & Architectural Insights
* **Replacing Native Browser Tooltips with Reactive Zero-Delay Micro-Popovers**:
  * *Insight*: Native browser `title="..."` tooltips are unstyled, delayed by 500ms–1000ms, and cannot present structured data hierarchies or colored progress gauges.
  * *Pattern*: In table cells ([SymbolRow.tsx](file:///d:/projects/mt5-risk-management-dashboard/frontend/src/components/matrix/SymbolRow.tsx)), wrap the cell content in a relative container (`.adr-cell-wrapper`) and trigger a floating micro-popover card (`.adr-telemetry-popover`) via local fine-grained Solid.js signals (`isAdrHovered`).
  * *Architecture*: Calculate session exhaustion baselines directly from streamed tick specifications (`data().spec.today_range_pips`, `data().spec.adr_used_pct`, `data().spec.room_up_pips`, `data().spec.room_down_pips`) without dispatching extra network roundtrips.

### Gotchas, Traps & Framework Quirks
* **Table Cell Hover Flickering caused by Child Popover Hit-Testing**:
  * *Trap*: When hovering over a parent element (`.adr-cell-wrapper`), rendering a popover directly below or adjacent to the cursor can transfer pointer hit-testing to the popover itself. If the mouse leaves or moves across the child card boundaries, the parent receives spurious `mouseleave` / `mouseenter` events, producing rapid visual flickering.
  * *Root Cause*: CSS pointer events default to `auto` on absolute child elements inside relative table cell containers.
  * *Fix*: Set `pointer-events: none;` on informational floating micro-popover cards (`.adr-telemetry-popover`). The mouse interaction remains solely on the underlying cell trigger, guaranteeing stable, flicker-free rendering.

* **Windows Command-Line CP1251 UnicodeEncodeError in Test Scripts**:
  * *Trap*: When printing extracted DOM text containing emojis or mathematical symbols (such as `📐`, `⚠️`, `↑`, `↓`) in test scripts running under Python on Windows, `print(text)` crashes with:
    `UnicodeEncodeError: 'charmap' codec can't encode character '\U0001f4d0' in position 0: character maps to <undefined>`.
  * *Root Cause*: Windows standard output defaults to legacy OEM/ANSI code pages (e.g. `cp1251`, `cp1252`, `cp437`) instead of UTF-8.
  * *Fix*: In automated test and scratch scripts on Windows, configure `sys.stdout.reconfigure(encoding='utf-8', errors='replace')` or avoid raw `print(unicode_dom_text)` directly to stdout.

* **Table Stacking Contexts and Overflow Clipping (`overflow: hidden`)**:
  * *Trap*: Tables with scroll wrappers or fixed column clipping can truncate or hide elements positioned with `position: absolute; top: calc(100% + 6px);`.
  * *Fix*: Ensure the popover's z-index is set high (`z-index: 1050`) and verify that parent `<td>` elements do not have `overflow: hidden` applied when hosting interactive floating telemetry cards.

### Domain & API Nuances
* **Daily ADR vs ATR Exhaustion Metrics**:
  * *Baseline*: 14D ADR (Average Daily Range) is computed over closed daily D1 bars ($High - Low$).
  * *Exhaustion State Machine*:
    * `adr_used_pct < 70%`: `NORMAL RANGE` (Emerald green `#089981`). Favorable for trend continuation.
    * `70% <= adr_used_pct < 90%`: `HIGH EXPANSION` (Amber `#f59e0b`). Caution for intraday breakout pullbacks.
    * `adr_used_pct >= 90%`: `⚠️ EXHAUSTED` (Crimson `#f23645`). High mean-reversion probability; long breakouts at the top of ADR have statistically negative expected value.
  * *Fallbacks*: When market is closed or at the start of a session where `today_range_pips` is not yet established, `adr_used_pct` can be `undefined`. Components must gracefully render baseline `adr_display` without breaking layout or displaying `NaN%`.

### Negative Knowledge (What NOT to Do)
1. **DO NOT rely on native browser `title` attributes for multi-dimensional telemetry**:
   - *Why*: Native tooltips cannot be styled, cannot render CSS progress bars or color-coded status badges, and induce unacceptable latency during rapid pre-trade scanning.
2. **DO NOT allow hover cards to block clicks on underlying table rows or adjacent execute buttons**:
   - *Why*: Floating cards with `pointer-events: auto` that overlap adjacent table rows or BUY/SELL execution buttons can inadvertently intercept emergency order clicks or double-click row expansions. Always use `pointer-events: none` on hover telemetry cards.

### Reusable Conventions & Rules
1. **Zero-Latency Telemetry Popover Pattern**:
   - High-density table cells requiring secondary telemetry must use the `<div class="*-cell-wrapper" onMouseEnter={...} onMouseLeave={...}>` pattern paired with `pointer-events: none` and `animation: popoverFadeIn 0.15s ease`.
2. **Exhaustion Color Palette Semantics**:
   - In all volatility and ADR telemetry, adhere strictly to the 3-state token mapping: `< 70%` $\rightarrow$ `--sys-color-profit`, `70%–89%` $\rightarrow$ `--sys-color-warning`, and `≥ 90%` $\rightarrow$ `--sys-color-loss`.

---

## 🏛️ 15. Completed Architecture Refactoring Summary (Phases 1–4 Across Full Stack)

### 📦 Backend Refactoring Milestones (Hexagonal Architecture)
* **Phase 1 (Domain Decoupling & Unified Margin)**:
  - Unified fragmented margin calculations into [`domain/math/margin_engine.py`](./domain/math/margin_engine.py).
  - Extracted pure cost-absorbing break-even math into [`domain/math/break_even.py`](./domain/math/break_even.py).
  - Standardized immutable domain entities on pure Pydantic v2 models (`AccountState`, `SymbolSpec`, `Position`, `TradeRecord`).
* **Phase 2 (Concurrency & Event Loop Hygiene)**:
  - Implemented [`MT5IPCWorker`](./infrastructure/ipc/mt5_worker.py) with a dedicated single-threaded executor (`max_workers=1`) for serialized Win32 C-extension access.
  - Implemented single-producer multi-consumer [`BroadcastHub`](./application/broadcaster.py), eliminating per-client polling storms over MT5 IPC.
  - Offloaded all synchronous margin/tick calculations out of FastAPI request handlers.
* **Phase 3 (Provider Abstraction & Dependency Injection)**:
  - Defined abstract [`IMarketDataProvider`](./infrastructure/providers/base.py) and [`IExecutionProvider`](./infrastructure/providers/base.py) interfaces.
  - Decomposed legacy 1,570-line `feed.py` into [`MT5NativeProvider`](./infrastructure/providers/mt5_provider.py) and [`MockDataProvider`](./infrastructure/providers/mock_provider.py).
  - Modularized `app.py` into FastAPI REST routers (`account.py`, `symbols.py`, `orders.py`, `positions.py`, `trades.py`) with `Depends()` injection.
* **Phase 4 (Institutional Hardening & OMS Gates)**:
  - Pinned all MT5 C-extension operations strictly to the worker thread via `MT5IPCWorker.call()`, resolving caller-thread deadlock and Win32 handle corruption.
  - Built institutional [`LiquidationService`](./application/liquidation_service.py) implementing atomic two-phase Smart Flatten (`cancel_all_orders` $\to$ `close_all_positions`), guaranteeing $\$0.00$ Net Delta.
  - Built [`PreTradeGatekeeper`](./domain/safety/gatekeeper.py) with rolling median spread surge interception ($>2.5\times$), pre-flight margin utilization check ($\le 95\%$ free margin), and 300ms order debouncing.
  - Streamed session ADR exhaustion metrics (`today_range_pips`, `adr_used_pct`, `room_up_pips`, `room_down_pips`) in 500ms broadcast frames.
* **Verification**: 64 automated pytest unit/integration tests passing (0 failures).

### 🎨 Frontend Refactoring Milestones (Solid.js Clean Architecture)
* **Phase 1 (Input Safety & Transport Resilience)**:
  - Fixed Stop Loss input trapping via decoupled drafting signal (`localVal`) paired with `isFocused` shielding.
  - Protected against `volumeStep <= 0` in [`lotCalculator.ts`](./frontend/src/utils/lotCalculator.ts) and zero-division in [`portfolioAnalytics.ts`](./frontend/src/utils/portfolioAnalytics.ts).
  - Built zero-dependency institutional [`httpClient.ts`](./frontend/src/services/httpClient.ts) and [`api.ts`](./frontend/src/services/api.ts) trapping transport errors and returning typed result contracts.
* **Phase 2 (Domain Extraction & Decomposition)**:
  - Extracted 4-way bidirectional synchronization ($\text{Price} \longleftrightarrow \text{Pips} \longleftrightarrow \text{Cash} \longleftrightarrow \text{R}$) into [`positionMath.ts`](./frontend/src/utils/positionMath.ts).
  - Decomposed `PositionRow.tsx` by extracting the 400-line inline editing popover into [`SltpEditHub.tsx`](./frontend/src/components/positions/SltpEditHub.tsx).
  - Consolidated Van Tharp $1R$ normalization baseline (`positionsStore.oneRCash()`) and centralized SL preset math (`computeDefaultSlPips`).
* **Phase 3 (Tokens & Design System Standards)**:
  - Created [`constants.ts`](./frontend/src/config/constants.ts) for storage keys, risk thresholds, and default leverage.
  - Purged all raw hex colors into a 3-Layer Design Token architecture (`tokens/primitives.css`, `tokens/semantic.css`, `views/*.css`) with CVD Cyan/Amber support.
* **Phase 4 (Performance & Ergonomics)**:
  - Built zero-allocation dual-buffer sparklines ([`CircularPriceBuffer`](./frontend/src/utils/sparklineBuffer.ts)) with retina DPI scaling and selective canvas rendering.
  - Enforced 5-state invariant hitbox execution engine ($64\text{px}$ locked geometry, 2px countdown bar, Instant Pivot contract).
  - Standardized psychological de-biasing stealth standard (`••••••`) and zero-latency micro-popovers (`pointer-events: none`).
* **Verification**: 23 Vitest unit tests passing; Vite production build compiling in ~700ms.

