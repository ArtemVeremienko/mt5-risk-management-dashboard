"""
Unit tests for BroadcastHub (Centralized Pub/Sub WebSocket Broadcaster).
"""

import asyncio
import pytest
from application.broadcaster import BroadcastHub


class MockWebSocket:
    def __init__(self, should_fail: bool = False):
        self.accepted = False
        self.received_messages = []
        self.should_fail = should_fail

    async def accept(self):
        self.accepted = True

    async def send_json(self, data):
        if self.should_fail:
            raise ConnectionResetError("Socket broken")
        self.received_messages.append(data)


@pytest.mark.anyio
async def test_broadcaster_connection_and_rate_resolution():
    hub = BroadcastHub(default_interval=2.0)
    assert hub.subscriber_count == 0
    assert hub.current_interval == 2.0

    ws1 = MockWebSocket()
    ws2 = MockWebSocket()

    # Connect client 1 in normal mode (2.0s)
    await hub.connect(ws1, initial_interval=2.0)
    assert ws1.accepted is True
    assert hub.subscriber_count == 1
    assert hub.current_interval == 2.0

    # Connect client 2 in turbo mode (0.5s) -> Fastest Wins
    await hub.connect(ws2, initial_interval=0.5)
    assert hub.subscriber_count == 2
    assert hub.current_interval == 0.5

    # Switch client 2 to 0.25s
    await hub.set_interval(ws2, 0.25)
    assert hub.current_interval == 0.25

    # Disconnect client 2 -> Cadence relaxes back to client 1's 2.0s
    await hub.disconnect(ws2)
    assert hub.subscriber_count == 1
    assert hub.current_interval == 2.0

    # Disconnect client 1 -> Default interval
    await hub.disconnect(ws1)
    assert hub.subscriber_count == 0
    assert hub.current_interval == 2.0


@pytest.mark.anyio
async def test_broadcaster_message_delivery_and_pruning():
    hub = BroadcastHub()
    good_ws = MockWebSocket(should_fail=False)
    broken_ws = MockWebSocket(should_fail=True)

    await hub.connect(good_ws)
    await hub.connect(broken_ws)
    assert hub.subscriber_count == 2

    # Broadcast test message
    payload = {"type": "symbols_update", "test": 123}
    await hub.broadcast(payload)

    # Good socket received message
    assert len(good_ws.received_messages) == 1
    assert good_ws.received_messages[0] == payload

    # Broken socket was automatically pruned from subscriber pool
    assert hub.subscriber_count == 1
    assert broken_ws not in hub.active_intervals


@pytest.mark.anyio
async def test_broadcaster_run_loop_execution():
    hub = BroadcastHub(default_interval=0.05)
    ws = MockWebSocket()
    await hub.connect(ws, initial_interval=0.05)

    counter = 0

    async def mock_producer():
        nonlocal counter
        counter += 1
        return {"count": counter}

    # Run loop in background
    task = asyncio.create_task(hub.run_loop(mock_producer))
    await asyncio.sleep(0.12)
    hub.stop()
    await task

    # Verify messages were received
    assert len(ws.received_messages) >= 2
    assert ws.received_messages[0]["count"] == 1
