"""
Unit tests for MT5IPCWorker (Single-Threaded Serialized MT5 IPC Queue).
"""

import asyncio
import threading
import time
import pytest

from infrastructure.ipc.mt5_worker import MT5IPCWorker


@pytest.mark.anyio
async def test_mt5_worker_async_run():
    worker = MT5IPCWorker()
    try:
        def compute(x: int, y: int) -> int:
            return x * y + 10

        result = await worker.run(compute, 5, 6)
        assert result == 40
    finally:
        worker.shutdown()


def test_mt5_worker_sync_call():
    worker = MT5IPCWorker()
    try:
        def get_thread_name():
            return threading.current_thread().name

        worker_thread_name = worker.call(get_thread_name)
        assert "MT5_IPC_Serial" in worker_thread_name
        # Verify it runs on a different thread than the caller
        assert worker_thread_name != threading.current_thread().name
    finally:
        worker.shutdown()


@pytest.mark.anyio
async def test_mt5_worker_serialization():
    worker = MT5IPCWorker()
    execution_order = []

    def task(task_id: int, sleep_duration: float):
        time.sleep(sleep_duration)
        execution_order.append(task_id)
        return task_id

    try:
        # Launch two tasks concurrently
        t1 = worker.run(task, 1, 0.05)
        t2 = worker.run(task, 2, 0.01)
        res1, res2 = await asyncio.gather(t1, t2)
        assert res1 == 1
        assert res2 == 2
        # Because the worker is single-threaded, task 1 must finish before task 2 starts
        assert execution_order == [1, 2]
    finally:
        worker.shutdown()


@pytest.mark.anyio
async def test_mt5_worker_exception_propagation():
    worker = MT5IPCWorker()

    def faulty():
        raise ValueError("Simulated MT5 IPC Memory Fault")

    try:
        with pytest.raises(ValueError, match="Simulated MT5 IPC Memory Fault"):
            await worker.run(faulty)
    finally:
        worker.shutdown()


def test_mt5_worker_sync_timeout():
    from infrastructure.ipc.mt5_worker import MT5IPCTimeoutError
    worker = MT5IPCWorker(default_timeout_seconds=0.1)

    def slow():
        time.sleep(0.3)
        return "done"

    try:
        with pytest.raises(MT5IPCTimeoutError):
            worker.call(slow)
    finally:
        worker.shutdown(wait=False)


@pytest.mark.anyio
async def test_mt5_worker_async_timeout():
    from infrastructure.ipc.mt5_worker import MT5IPCTimeoutError
    worker = MT5IPCWorker(default_timeout_seconds=0.1)

    def slow():
        time.sleep(0.3)
        return "done"

    try:
        with pytest.raises(MT5IPCTimeoutError):
            await worker.run(slow)
    finally:
        worker.shutdown(wait=False)

