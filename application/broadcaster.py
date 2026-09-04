"""
Centralized Pub/Sub BroadcastHub for real-time market data streaming.
Single-Producer, Multi-Consumer architecture eliminating per-client polling storms over MT5 IPC.
"""

import asyncio
import logging
from typing import Dict, Any, Optional, Callable, Awaitable

logger = logging.getLogger("BroadcastHub")


class BroadcastHub:
    """
    Manages WebSocket subscribers and runs a single centralized broadcast loop.
    Dynamically adjusts broadcast cadence according to fastest active subscriber.
    """

    def __init__(self, default_interval: float = 2.0):
        self.active_intervals: Dict[Any, float] = {}
        self.default_interval = default_interval
        self._lock = asyncio.Lock()
        self._running = False
        self._broadcast_task: Optional[asyncio.Task] = None

    @property
    def current_interval(self) -> float:
        """
        Dynamically computes current broadcast cadence (Fastest Wins):
        Returns min(active_intervals) if clients are connected, or default_interval.
        """
        if not self.active_intervals:
            return self.default_interval
        return max(0.1, min(self.active_intervals.values()))

    @property
    def subscriber_count(self) -> int:
        """Returns the number of currently active connected subscribers."""
        return len(self.active_intervals)

    async def connect(self, websocket: Any, initial_interval: float = 2.0):
        """Accepts and registers a new WebSocket subscriber."""
        if hasattr(websocket, "accept"):
            await websocket.accept()
        async with self._lock:
            self.active_intervals[websocket] = max(0.1, float(initial_interval))

    async def disconnect(self, websocket: Any):
        """Unregisters a WebSocket subscriber."""
        async with self._lock:
            self.active_intervals.pop(websocket, None)

    async def set_interval(self, websocket: Any, interval_seconds: float):
        """Updates the streaming cadence preference for a specific subscriber."""
        async with self._lock:
            if websocket in self.active_intervals:
                self.active_intervals[websocket] = max(0.1, float(interval_seconds))

    def get_interval(self, websocket: Any) -> float:
        """Returns the requested interval for a specific subscriber."""
        return self.active_intervals.get(websocket, self.default_interval)

    async def broadcast(self, payload: Dict[str, Any]):
        """Pushes framed payload to all connected subscribers and prunes broken sockets."""
        if not self.active_intervals:
            return

        to_remove = set()
        for ws in list(self.active_intervals.keys()):
            try:
                await ws.send_json(payload)
            except Exception:
                to_remove.add(ws)

        if to_remove:
            async with self._lock:
                for ws in to_remove:
                    self.active_intervals.pop(ws, None)

    async def run_loop(self, producer_func: Callable[[], Awaitable[Optional[Dict[str, Any]]]]):
        """
        Main single-producer coroutine loop.
        Polls once per interval and broadcasts to all active subscribers.
        Sleeps idle when subscriber count is 0.
        """
        self._running = True
        while self._running:
            if self.subscriber_count == 0:
                await asyncio.sleep(0.5)
                continue

            start_time = asyncio.get_event_loop().time()
            try:
                payload = await producer_func()
                if payload is not None:
                    await self.broadcast(payload)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error producing broadcast payload: {e}", exc_info=True)

            elapsed = asyncio.get_event_loop().time() - start_time
            sleep_duration = max(0.01, self.current_interval - elapsed)
            try:
                await asyncio.sleep(sleep_duration)
            except asyncio.CancelledError:
                break

    def stop(self):
        """Stops the broadcast loop."""
        self._running = False
