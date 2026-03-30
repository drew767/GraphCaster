# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import time
from unittest.mock import Mock

from graph_caster.resilience.watchdog import WorkerStatus, WorkerWatchdog


class TestWorkerWatchdog:
    def test_register_worker(self):
        watchdog = WorkerWatchdog(check_interval=0.1)
        watchdog.register("worker-1", timeout=5.0)
        assert watchdog.get_status("worker-1") == WorkerStatus.HEALTHY

    def test_heartbeat_keeps_alive(self):
        watchdog = WorkerWatchdog(check_interval=0.1)
        watchdog.register("worker-1", timeout=0.5)
        for _ in range(3):
            watchdog.heartbeat("worker-1")
            time.sleep(0.1)
        assert watchdog.get_status("worker-1") == WorkerStatus.HEALTHY

    def test_timeout_marks_dead(self):
        watchdog = WorkerWatchdog(check_interval=0.05)
        watchdog.register("worker-1", timeout=0.1)
        time.sleep(0.2)
        watchdog._check_workers()
        assert watchdog.get_status("worker-1") == WorkerStatus.DEAD

    def test_callback_on_death(self):
        callback = Mock()
        watchdog = WorkerWatchdog(check_interval=0.05, on_worker_dead=callback)
        watchdog.register("worker-1", timeout=0.1, run_id="run-123")
        time.sleep(0.2)
        watchdog._check_workers()
        callback.assert_called_once()
        call_args = callback.call_args[0]
        assert call_args[0] == "worker-1"
        assert call_args[1] == "run-123"

    def test_unregister_worker(self):
        watchdog = WorkerWatchdog(check_interval=0.1)
        watchdog.register("worker-1", timeout=5.0)
        watchdog.unregister("worker-1")
        assert watchdog.get_status("worker-1") == WorkerStatus.UNKNOWN

    def test_multiple_workers(self):
        watchdog = WorkerWatchdog(check_interval=0.1)
        watchdog.register("worker-1", timeout=5.0)
        watchdog.register("worker-2", timeout=5.0)
        watchdog.register("worker-3", timeout=0.1)
        watchdog.heartbeat("worker-1")
        watchdog.heartbeat("worker-2")
        time.sleep(0.2)
        watchdog._check_workers()
        assert watchdog.get_status("worker-1") == WorkerStatus.HEALTHY
        assert watchdog.get_status("worker-2") == WorkerStatus.HEALTHY
        assert watchdog.get_status("worker-3") == WorkerStatus.DEAD
