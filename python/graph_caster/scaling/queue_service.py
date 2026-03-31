# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from graph_caster.scaling.job_processor import process_run_job_payload
from graph_caster.scaling.types import RunJob

_STRING_JOB_TARGET = "graph_caster.scaling.job_processor.process_run_job_payload"


class RunQueueService:
    """Thin RQ wrapper; requires ``pip install -e '.[scaling]'``."""

    def __init__(self, redis_url: str, queue_name: str = "gc:runs") -> None:
        try:
            from redis import Redis
            from rq import Queue
        except ImportError as e:
            raise RuntimeError(
                "RunQueueService requires optional deps: pip install -e '.[scaling]'",
            ) from e
        self._redis = Redis.from_url(redis_url)
        self._queue: Queue = Queue(queue_name, connection=self._redis)

    def enqueue(self, job: RunJob) -> str:
        payload = job.to_dict()
        rq_job = self._queue.enqueue(_STRING_JOB_TARGET, payload, job_id=job.job_id)
        return str(rq_job.id)

    @staticmethod
    def process_inline(job: RunJob) -> dict:
        """Run without Redis (tests / local drain)."""
        return process_run_job_payload(job.to_dict())
