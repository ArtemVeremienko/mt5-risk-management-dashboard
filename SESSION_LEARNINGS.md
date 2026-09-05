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
