# 🏛️ Backend Architecture Audit & Refactoring Plan

> **Target**: MT5 Risk Management & Dynamic Lot Sizing Dashboard (`Python Backend`)  
> **Auditor**: Antigravity Backend Architecture Critic  
> **Date**: September 2026  
> **Status**: Approved Roadmap / In-Progress

---

## 1. Executive Summary

The backend delivers mathematically sound quantitative models (Fixed Fractional, Half Kelly, Ralph Vince optimal $f$, Van Tharp $R$-multiples, and regulatory CFD unscaled margin shielding). However, the backend is currently architected as a monolithic script rather than an institutional-grade service. It suffers from **event-loop blocking violations**, **per-client IPC polling storms**, and a **1,570-line God-class (`feed.py`)** that tightly couples broker I/O, domain math, order execution, and mock generation.

This document serves as the master architectural refactoring blueprint to decouple the system into a **Hexagonal / Ports & Adapters** architecture, resolve concurrency bottlenecks, and enable upcoming roadmap milestones from [TODO.md](./TODO.md) and [STREAMING_PLAN.md](./STREAMING_PLAN.md).

---

## 2. Key Audit Findings & Architectural Bottlenecks

### 2.1 Concurrency & Event Loop Hygiene
* **Per-Client IPC Polling Storm (`app.py:L484-L528`)**:
  Every connected WebSocket client launches its own independent polling loop querying MT5 IPC at 500ms intervals. If 5 tabs/browsers are open, 10 full Market Watch scans, 10 account queries, and 10 position audits hit the MT5 IPC bridge every second ($O(N)$ IPC scaling).
  * **Remedy**: Adopt a **Single Background Broadcast Hub (Pub/Sub pattern)**. One task samples at the configured rate and broadcasts snapshots to all connected subscribers via `BroadcastHub`.
* **Synchronous MT5 IPC Calls Freezing the Event Loop (`app.py:L227, L266, L285`)**:
  Synchronous broker calls (`feed.calculate_margin`) are invoked directly inside an `async def` FastAPI handler on every symbol in the matrix without thread offloading, causing main thread lockups for all HTTP and WebSocket clients.
  * **Remedy**: Offload all synchronous computations/IPC calls or use cached symbol specifications.
* **Unbounded Thread Pool vs. Single Serialized IPC Worker (`feed.py:L152`)**:
  `asyncio.to_thread` delegates to Python's default thread pool (up to 32 worker threads) wrapped in an `RLock`. MetaTrader 5's `.pyd` Win32 IPC operates on a single shared memory / named pipe buffer. Multiple threads competing for the lock causes thread pool starvation and IPC stalls.
  * **Remedy**: Route all MT5 C-extension calls through a dedicated serialized queue (`ThreadPoolExecutor(max_workers=1, thread_name_prefix="MT5_IPC")`).
* **Unsynchronized Memory Cache Reads (`feed.py:L427-L429`)**:
  `self._volatility_cache` is read in `_calculate_adr_and_atr` outside `_mt5_lock` while mutated in background threads, risking dictionary resize race conditions.

---

### 2.2 Design Patterns & Architecture
* **God-Class Monolith (`MT5RiskFeed` in `feed.py`)**:
  A single 1,570-line class mixes 9 separate responsibilities:
  1. Terminal connection lifecycle & recovery
  2. Synthetic mock data generation
  3. Instrument categorization & pip rules
  4. 14D ADR / ATR volatility calculations
  5. Order execution & slippage control
  6. Position tracking & $1R$ risk caching
  7. Universal cost-absorbing break-even math
  8. Partial scale-out liquidation
  9. Margin checks
* **Margin Logic Duplication & Divergence**:
  Margin calculations are implemented redundantly in both `margin_engine.py` and `risk_calculator.py:L330-L403`, each having separate asset categorization rules and hardcoded currency edge cases (e.g. `JP225` and `DE40` multipliers in one but not the other).
* **Missing Dependency Injection & Global Singletons**:
  Endpoints import global singletons (`feed = MT5RiskFeed()`, `manager = LiveConnectionManager()`) directly. This inhibits unit testing, requires monkey-patching, and prevents swapping mock or socket providers dynamically.
* **Typing & Validation Dissonance**:
  Domain models use `@dataclass`, HTTP requests use Pydantic `BaseModel`, and endpoints return untyped `dict`/`list` objects without `response_model` schemas, losing Swagger/OpenAPI type contract benefits.

---

### 2.3 Roadblocks for `TODO.md` Roadmap Items

| Roadmap Milestone | Scope & Requirements | Existing Backend Architecture Blocker |
| :--- | :--- | :--- |
| **Phase 1: Smart Flatten Engine** ([TODO.md](./TODO.md)) | Close 100% of open positions AND delete active pending orders (`orders_get` + `order_delete`) for true \$0.00 net exposure. | `feed.close_all_positions` only tracks market positions. Tight coupling makes dual-mode liquidation clumsy. |
| **Phase 4: Pre-Trade Risk Gatekeeper** ([TODO.md](./TODO.md)) | 14D rolling median spread guard ($>2.5\times$), pre-flight margin health check (`Req Margin <= Free Margin * 0.95`), and max risk ceiling. | `send_market_order` has no pre-flight interception pipeline. Spread tracking is instantaneous with no rolling median buffer. |
| **Phase 5: Session ADR Exhaustion Telemetry** ([TODO.md](./TODO.md)) | Intraday D1 extremes, `adr_used_pct`, `adr_left_pips`, `room_up_pips`, and `room_down_pips` streamed in 500ms packets. | `_calculate_adr_and_atr` skips bar 0. Querying intraday bar 0 in the 500ms loop without a vectorized cache would re-introduce IPC latency. |
| **Future: Provider Abstraction Layer** ([TODO.md](./TODO.md)) | Standardized `IMarketDataProvider` and `IExecutionProvider` for MT5, MQL5 Socket Push, and Mock Data. | `app.py` is directly coupled to concrete `feed.py` methods; no interface boundaries exist. |
| **Future: Native MQL5 TCP Socket Push Bridge** ([STREAMING_PLAN.md](./STREAMING_PLAN.md)) | Asyncio TCP server (:9090 / :9091) pushing sub-ms NDJSON ticks and transactions. | Current WebSocket architecture relies on per-client polling rather than an event-driven pub/sub bus. |

---

### 2.4 Architectural Audit & Hexagonal Review Findings (Post-Phase 3 Audit)

An architectural audit of the Phase 3 implementation by the Principal Systems Architect identified the following institutional gaps and critical concurrency nuances:

* **2.4.1 MT5 IPC Thread-Pinning Defect in `MT5NativeProvider` (Critical Concurrency Flaw)**:
  * **Finding**: While `MT5IPCWorker` instantiated a dedicated single-threaded executor (`ThreadPoolExecutor(max_workers=1, thread_name_prefix="MT5_IPC_Serial")`), `MT5NativeProvider` did not dispatch calls to this executor. Instead, it acquired `self._mt5_lock = self._ipc_worker._lock` within synchronous methods invoked via `asyncio.to_thread()`.
  * **Risk**: Work was executed on arbitrary worker threads allocated from Python's unbounded thread pool. Although the lock prevented concurrent execution, MetaTrader 5's `.pyd` Win32 IPC channel relies on thread-local resources and named pipe state. Invoking MT5 across shifting OS thread IDs risks Win32 memory access violations (`0xC0000005`), IPC handle corruption, or driver stalls under heavy load.
  * **Remedy**: Bind all MT5 C-extension invocations strictly to the dedicated serial thread via `self._ipc_worker.call(func, *args, **kwargs)` or `self._ipc_worker.run(...)`.

* **2.4.2 Resolution of the "Compatibility Facade" Anti-Pattern (Domain Model Purity)**:
  * **Finding**: `feed.py` initially retained an `MT5RiskFeed` subclass that overrode provider methods to return `.model_dump()` dictionaries to satisfy outdated test assertions. This violated the `IMarketDataProvider` interface contract and caused `AttributeError: 'dict' object has no attribute 'leverage'` in business services.
  * **Remedy**: Eliminated dictionary emulation methods (`__getitem__`, `__contains__`, `get`) on domain models. Domain entities are pure immutable Pydantic v2 models (`DomainModel`), and tests/services strictly access fields using dot-notation attribute syntax (`pos.r_multiple`, `sym.adr_14_pips`).

* **2.4.3 Pre-Trade Risk Gatekeeper Gap in `ExecutionService` (Institutional OMS Nuance)**:
  * **Finding**: `ExecutionService.send_market_order()` currently operates as a naive pass-through router to `provider.send_market_order()`.
  * **Risk**: Missing pre-trade validation leaves the terminal vulnerable to high slippage during spread blowouts (e.g. rollover or news spikes), account margin exhaustion, or duplicate orders from rapid accidental double-clicks.
  * **Remedy**: Implement a Pre-Trade Risk Gatekeeper in `ExecutionService`:
    1. **Spread Blowout Guard**: Intercept and block/warn if `current_spread > 2.5 * median_spread`.
    2. **Pre-Flight Margin Utilization Check**: Reject order if projected `margin_utilization > 80%` or `required_margin > free_margin * 0.95`.
    3. **Order Debouncing / Idempotency Key**: Enforce a 300ms debounce window and validate optional `client_order_id` to eliminate duplicate fills.

* **2.4.4 The "$0 Delta" Liquidation Gap (Smart Flatten vs. Basic Close)**:
  * **Finding**: `ExecutionService.close_all_positions()` only iterates through market positions (`positions_get`). It does not cancel active pending orders (`orders_get` — Buy/Sell Limits, Buy/Sell Stops).
  * **Risk**: In institutional and prop trading, clicking "Emergency Flatten" requires guaranteed **$0 Delta Exposure**. Leaving open limit orders on the book exposes the account to latent execution if the market swings into order levels.
  * **Remedy**: Introduce `IExecutionProvider.cancel_all_orders()` and a dedicated `LiquidationService` implementing a two-phase atomic flatten sequence: cancel 100% of pending orders, then liquidate 100% of market positions.

---

## 3. Target Architecture: Hexagonal / Ports & Adapters

```
                    ┌──────────────────────────────────────────────────┐
                    │               PRESENTATION LAYER                 │
                    │   FastAPI Modular Routers & PubSub BroadcastHub  │
                    └────────────▲─────────────────────────▲───────────┘
                                 │                         │
                                 │ Dependencies (Depends)  │
                                 │                         │
                    ┌────────────▼─────────────────────────▼───────────┐
                    │                APPLICATION LAYER                 │
                    │   MarketDataService   │   ExecutionService       │
                    │   RiskOrchestrator    │   LiquidationService     │
                    └────────────▲─────────────────────────▲───────────┘
                                 │                         │
            Implements Interfaces│                         │ Executes Domain Rules
                                 │                         │
┌────────────────────────────────┴───────────┐   ┌─────────┴────────────────────────┐
│           INFRASTRUCTURE LAYER             │   │           DOMAIN LAYER           │
│  - Providers (IMarketDataProvider,         │   │   (Pure Math, Zero I/O, Zero MT5)│
│               IExecutionProvider)          │   │  - Lot Sizing Models (Kelly,f*,%) │
│    ├── MT5NativeProvider (Worker Queue)    │   │  - Unified Margin Engine         │
│    ├── MQL5SocketPushProvider (TCP:9090)   │   │  - Volatility & ADR Math         │
│    └── MockDataProvider                   │   │  - Universal Break-Even Formula  │
│  - MT5DedicatedWorker (1-Thread IPC Queue) │   │  - Pre-Trade Safety Gatekeeper   │
│  - ProviderManager (Auto-failover)         │   │  - Domain Models (Pydantic v2)   │
└────────────────────────────────────────────┘   └──────────────────────────────────┘
```

### Proposed Modular Directory Structure

```
risk_management_dashboard/
├── config/
│   └── settings.py              # Pydantic v2 Settings (Host, Port, Turbo Interval, Safety Caps)
├── domain/                      # PURE DOMAIN (Zero I/O, Zero MT5 imports, 100% Unit Testable)
│   ├── models/                  # AccountState, SymbolSpec, Position, TradeRecord, TradeStats
│   ├── math/                    # risk_models.py, margin_engine.py, break_even.py, volatility.py
│   └── safety/                  # gatekeeper.py (Spread surge, Pre-flight margin limits)
├── infrastructure/              # INFRASTRUCTURE & I/O ADAPTERS
│   ├── ipc/                     # mt5_worker.py (Single-threaded serialized MT5 executor)
│   ├── providers/               # base.py (IMarketDataProvider, IExecutionProvider), mt5_native.py, mock_provider.py
│   └── cache/                   # memory_store.py (Thread-safe cache & spread ring-buffers)
├── application/                 # APPLICATION SERVICES & USE CASES
│   ├── market_service.py        # Market data orchestration & volatility caching
│   ├── execution_service.py     # Order placement, break-even snapping, partial close
│   ├── liquidation_service.py   # Smart Flatten vs Close All engine
│   └── broadcaster.py           # Centralized Pub/Sub WebSocket broadcast hub
├── presentation/                # PRESENTATION LAYER (FastAPI)
│   ├── dependencies.py          # FastAPI Depends() injection container
│   ├── routers/                 # account.py, symbols.py, trades.py, orders.py, positions.py
│   └── websocket/               # live_stream.py (/ws/live hub subscriber)
├── app.py                       # App factory & lifespan lifecycle
├── main.py                      # Uvicorn launcher
└── tests/                       # Separated unit/ and integration/ test suites
```

---

## 4. Interface Specifications

### 4.1 Provider Interfaces (`infrastructure/providers/base.py`)

```python
from abc import ABC, abstractmethod
from typing import List, Optional, Dict, Any
from domain.models.symbol import SymbolSpec, TickQuote
from domain.models.account import AccountState
from domain.models.position import Position, TradeRecord

class IMarketDataProvider(ABC):
    @property
    @abstractmethod
    def is_connected(self) -> bool: ...

    @abstractmethod
    async def get_account_summary(self) -> AccountState: ...

    @abstractmethod
    async def get_market_symbols(self) -> List[SymbolSpec]: ...

    @abstractmethod
    async def get_symbol_spec(self, symbol: str) -> Optional[SymbolSpec]: ...

    @abstractmethod
    async def fetch_trade_history(self, days: Optional[int] = None) -> List[TradeRecord]: ...

    @abstractmethod
    async def get_open_positions(self) -> List[Position]: ...

class IExecutionProvider(ABC):
    @abstractmethod
    async def send_market_order(
        self, symbol: str, action: str, volume: float, sl_pips: float, rr_ratio: float, comment: str
    ) -> Dict[str, Any]: ...

    @abstractmethod
    async def modify_position(self, ticket: int, sl: Optional[float], tp: Optional[float]) -> Dict[str, Any]: ...

    @abstractmethod
    async def close_position(self, ticket: int, volume: Optional[float] = None) -> Dict[str, Any]: ...

    @abstractmethod
    async def close_all_positions(self) -> List[Dict[str, Any]]: ...

    @abstractmethod
    async def cancel_all_orders(self) -> List[Dict[str, Any]]: ...
```

### 4.2 Dedicated Single-Threaded MT5 Worker Queue (`infrastructure/ipc/mt5_worker.py`)

```python
import asyncio
import concurrent.futures
import threading
from typing import Callable, TypeVar, Any

T = TypeVar("T")

class MT5IPCWorker:
    """
    Guarantees thread-safe, serialized access to the MetaTrader 5 C-extension.
    Shields against memory violations (0xC0000005) and socket hangs.
    """
    def __init__(self):
        self._executor = concurrent.futures.ThreadPoolExecutor(
            max_workers=1,
            thread_name_prefix="MT5_IPC_Serial_Worker"
        )
        self._lock = threading.RLock()

    async def run(self, func: Callable[..., T], *args: Any, **kwargs: Any) -> T:
        loop = asyncio.get_running_loop()
        def _guarded_call() -> T:
            with self._lock:
                return func(*args, **kwargs)
        return await loop.run_in_executor(self._executor, _guarded_call)

    def shutdown(self):
        self._executor.shutdown(wait=True)
```

### 4.3 Centralized WebSocket Broadcast Hub (`application/broadcaster.py`)

```python
import asyncio
import logging
from typing import Set, Dict, Any, Optional
from fastapi import WebSocket

logger = logging.getLogger("Broadcaster")

class BroadcastHub:
    """
    Single-Producer, Multi-Consumer real-time broadcasting hub.
    Eliminates per-client polling storms over MT5 IPC.
    """
    def __init__(self):
        self._subscribers: Set[WebSocket] = set()
        self._interval: float = 0.5  # 500ms default turbo
        self._lock = asyncio.Lock()
        self._running = False
        self._broadcast_task: Optional[asyncio.Task] = None

    async def register(self, ws: WebSocket):
        async with self._lock:
            self._subscribers.add(ws)

    async def unregister(self, ws: WebSocket):
        async with self._lock:
            self._subscribers.discard(ws)

    async def set_rate(self, interval_seconds: float):
        self._interval = max(0.1, interval_seconds)

    async def broadcast(self, payload: Dict[str, Any]):
        if not self._subscribers:
            return
        to_drop = set()
        for ws in list(self._subscribers):
            try:
                await ws.send_json(payload)
            except Exception:
                to_drop.add(ws)
        if to_drop:
            async with self._lock:
                self._subscribers.difference_update(to_drop)

    async def run_loop(self, producer_func):
        while self._running:
            start = asyncio.get_event_loop().time()
            if self._subscribers:
                try:
                    payload = await producer_func()
                    await self.broadcast(payload)
                except Exception as e:
                    logger.error(f"Broadcast error: {e}", exc_info=True)
            elapsed = asyncio.get_event_loop().time() - start
            await asyncio.sleep(max(0.01, self._interval - elapsed))
```

---

## 5. Phased Refactoring Roadmap

```
Phase 1: Domain Decoupling & Unified Margin Engine (Zero Regressions) [COMPLETED]
   ├── [x] 1.1 Unify margin calculations from margin_engine.py and risk_calculator.py into domain/math/margin_engine.py
   ├── [x] 1.2 Extract pure break-even math from feed.py into domain/math/break_even.py
   └── [x] 1.3 Standardize domain models & API schemas on Pydantic v2

Phase 2: Concurrency & Event Loop Safeguarding [COMPLETED]
   ├── [x] 2.1 Implement MT5IPCWorker (Dedicated max_workers=1 ThreadPoolExecutor for MT5 C-extension)
   ├── [x] 2.2 Implement BroadcastHub (Pub/Sub WebSocket hub eliminating per-client polling storms)
   └── [x] 2.3 Eliminate event loop blocking calls in /api/calculate

Phase 3: Provider Abstraction & FastAPI Dependency Injection [COMPLETED]
   ├── [x] 3.1 Define IMarketDataProvider and IExecutionProvider abstract interfaces
   ├── [x] 3.2 Refactor feed.py into MT5NativeProvider and MockDataProvider
   └── [x] 3.3 Split app.py into modular routers with FastAPI Depends() injection

Phase 4: Implementation of TODO.md Features & Institutional Hardening [COMPLETED]
   ├── [x] 4.1 Pin MT5 IPC to Dedicated Worker Thread (P0 Concurrency Defect)
   │     Route all MT5 C-extension operations through MT5IPCWorker.call() rather than random threads
   ├── [x] 4.2 Smart Flatten ($0 Delta) Engine & LiquidationService (P1 Liquidation Gap)
   │     Add cancel_all_orders() to IExecutionProvider, cancel active pending orders prior to position liquidation
   ├── [x] 4.3 Pre-Trade Risk Gatekeeper & Idempotency Pipeline (P2 OMS Gate)
   │     Spread blowout guard (>2.5x median), pre-flight margin utilization check, and order debouncing
   └── [x] 4.4 Session ADR Exhaustion Telemetry in 500ms broadcast stream (P3 HUD Telemetry)
         Intraday D1 extremes, adr_used_pct, room_up_pips, room_down_pips in 500ms broadcast stream

Phase 5: Native MQL5 TCP Socket Push Bridge (STREAMING_PLAN.md)
   ├── 5.1 Asyncio TCP server (:9090 / :9091) for NDJSON stream ingestion
   └── 5.2 MQL5SocketPushProvider with automatic fallback to MT5NativeProvider
```
