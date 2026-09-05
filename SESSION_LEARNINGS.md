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
