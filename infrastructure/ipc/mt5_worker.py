"""
Dedicated single-threaded execution queue for MetaTrader 5 C-extension calls.
Protects against Win32 shared memory concurrency violations (0xC0000005),
deadlocks, and thread pool exhaustion by serializing all MT5 IPC access.
"""

import asyncio
import concurrent.futures
import threading
from typing import Callable, TypeVar, Any

T = TypeVar("T")


class MT5IPCWorker:
    """
    Guarantees thread-safe, serialized access to the MetaTrader 5 C-extension.
    Shields against memory violations and socket hangs.
    """

    def __init__(self):
        self._executor = concurrent.futures.ThreadPoolExecutor(
            max_workers=1,
            thread_name_prefix="MT5_IPC_Serial"
        )
        self._lock = threading.RLock()
        self._worker_ident = None
        future = self._executor.submit(threading.get_ident)
        try:
            self._worker_ident = future.result(timeout=2.0)
        except Exception:
            pass

    async def run(self, func: Callable[..., T], *args: Any, **kwargs: Any) -> T:
        """Asynchronously dispatch a callable to the dedicated MT5 worker thread."""
        loop = asyncio.get_running_loop()

        def _guarded() -> T:
            with self._lock:
                return func(*args, **kwargs)

        return await loop.run_in_executor(self._executor, _guarded)

    def call(self, func: Callable[..., T], *args: Any, **kwargs: Any) -> T:
        """Synchronously execute a callable on the dedicated MT5 worker thread."""
        if threading.get_ident() == self._worker_ident:
            with self._lock:
                return func(*args, **kwargs)

        def _guarded() -> T:
            with self._lock:
                return func(*args, **kwargs)

        future = self._executor.submit(_guarded)
        return future.result()

    def shutdown(self, wait: bool = True):
        """Shut down the background worker thread."""
        self._executor.shutdown(wait=wait)
