"""
Dedicated single-threaded execution queue for MetaTrader 5 C-extension calls.
Protects against Win32 shared memory concurrency violations (0xC0000005),
deadlocks, and thread pool exhaustion by serializing all MT5 IPC access.
"""

import asyncio
import concurrent.futures
import threading
import logging
from typing import Callable, TypeVar, Any, Optional

logger = logging.getLogger("MT5IPCWorker")
T = TypeVar("T")


class MT5IPCTimeoutError(TimeoutError):
    """Raised when an MT5 C-extension call exceeds bounded execution timeout."""
    pass


class MT5IPCWorker:
    """
    Guarantees thread-safe, serialized access to the MetaTrader 5 C-extension.
    Shields against memory violations, deadlocks, and worker thread starvation.
    """

    def __init__(self, default_timeout_seconds: float = 5.0):
        self._default_timeout = default_timeout_seconds
        self._executor = concurrent.futures.ThreadPoolExecutor(
            max_workers=1,
            thread_name_prefix="MT5_IPC_Serial"
        )
        self._lock = threading.RLock()
        self._worker_ident: Optional[int] = None
        future = self._executor.submit(threading.get_ident)
        try:
            self._worker_ident = future.result(timeout=2.0)
        except Exception as e:
            logger.warning(f"Unable to capture MT5 worker thread ident: {e}")

    async def run(self, func: Callable[..., T], *args: Any, timeout: Optional[float] = None, **kwargs: Any) -> T:
        """Asynchronously dispatch a callable to the dedicated MT5 worker thread with bounded timeout."""
        loop = asyncio.get_running_loop()
        effective_timeout = timeout if timeout is not None else self._default_timeout

        def _guarded() -> T:
            with self._lock:
                return func(*args, **kwargs)

        fut = loop.run_in_executor(self._executor, _guarded)
        if effective_timeout and effective_timeout > 0:
            try:
                return await asyncio.wait_for(fut, timeout=effective_timeout)
            except asyncio.TimeoutError:
                logger.error(f"MT5 worker async call timed out after {effective_timeout}s: {getattr(func, '__name__', str(func))}")
                raise MT5IPCTimeoutError(f"MT5 C-extension call timed out after {effective_timeout}s")
        return await fut

    def call(self, func: Callable[..., T], *args: Any, timeout: Optional[float] = None, **kwargs: Any) -> T:
        """Synchronously execute a callable on the dedicated MT5 worker thread with bounded timeout."""
        effective_timeout = timeout if timeout is not None else self._default_timeout

        if threading.get_ident() == self._worker_ident:
            with self._lock:
                return func(*args, **kwargs)

        def _guarded() -> T:
            with self._lock:
                return func(*args, **kwargs)

        future = self._executor.submit(_guarded)
        try:
            if effective_timeout and effective_timeout > 0:
                return future.result(timeout=effective_timeout)
            return future.result()
        except concurrent.futures.TimeoutError:
            logger.error(f"MT5 worker call timed out after {effective_timeout}s: {getattr(func, '__name__', str(func))}")
            raise MT5IPCTimeoutError(f"MT5 C-extension call timed out after {effective_timeout}s")

    def shutdown(self, wait: bool = True):
        """Shut down the background worker thread."""
        self._executor.shutdown(wait=wait)
