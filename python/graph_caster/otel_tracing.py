# Copyright GraphCaster. All Rights Reserved.

"""Optional OpenTelemetry tracing for graph runs (install ``graph-caster[otel]``, set OTLP env)."""

from __future__ import annotations

import contextlib
import logging
import os
from typing import Any, Iterator

INSTRUMENTATION_NAME = "graph-caster"
INSTRUMENTATION_VERSION = "0.1.0"

_logger = logging.getLogger(__name__)

_configured: bool = False


def is_otel_configured() -> bool:
    if os.environ.get("GC_OTEL_EXPORTER_OTLP_ENDPOINT", "").strip():
        return True
    if os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip():
        return True
    if os.environ.get("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "").strip():
        return True
    return False


def _resolve_otlp_traces_endpoint() -> str | None:
    te = os.environ.get("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "").strip()
    if te:
        return te
    base = os.environ.get("GC_OTEL_EXPORTER_OTLP_ENDPOINT", "").strip() or os.environ.get(
        "OTEL_EXPORTER_OTLP_ENDPOINT", ""
    ).strip()
    if not base:
        return None
    base = base.rstrip("/")
    if base.endswith("/v1/traces"):
        return base
    return f"{base}/v1/traces"


def configure_otel(*, test_span_exporter: Any | None = None) -> None:
    """Install a global TracerProvider when env requests OTLP or when ``test_span_exporter`` is passed."""
    global _configured
    if _configured:
        return
    if test_span_exporter is None and not is_otel_configured():
        return
    try:
        from opentelemetry import trace
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor, SimpleSpanProcessor
    except ImportError:
        if test_span_exporter is not None or is_otel_configured():
            _logger.warning(
                "OpenTelemetry requested but opentelemetry-sdk (or dependency) is not installed; "
                "install graph-caster[otel]. Traces will not be exported.",
            )
        return

    service_name = os.environ.get("OTEL_SERVICE_NAME", "").strip() or "graph-caster"
    resource = Resource.create({"service.name": service_name})
    provider = TracerProvider(resource=resource)

    if test_span_exporter is not None:
        provider.add_span_processor(SimpleSpanProcessor(test_span_exporter))
    else:
        endpoint = _resolve_otlp_traces_endpoint()
        if not endpoint:
            _logger.warning(
                "OpenTelemetry OTLP traces endpoint missing; set GC_OTEL_EXPORTER_OTLP_ENDPOINT, "
                "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT, or OTEL_EXPORTER_OTLP_ENDPOINT. Traces not exported.",
            )
            return
        try:
            from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        except ImportError:
            _logger.warning(
                "OpenTelemetry OTLP HTTP exporter not available; install graph-caster[otel]. Traces not exported.",
            )
            return
        exporter = OTLPSpanExporter(endpoint=endpoint)
        provider.add_span_processor(BatchSpanProcessor(exporter))

    trace.set_tracer_provider(provider)
    _configured = True


def reset_otel_for_testing() -> None:
    """Only clears the internal "already configured" flag (for advanced tests).

    The global OpenTelemetry :class:`TracerProvider` **cannot** be replaced after the first
    successful :func:`configure_otel` in a process. Calling :func:`configure_otel` again after
    this reset will **not** attach a second exporter or replace the provider; use a **subprocess**
    if you need a fresh SDK. Normal tests configure **once** per interpreter (see
    ``tests/test_otel_tracing.py``).
    """
    global _configured
    _configured = False


class _NoOpSpan:
    def set_status(self, *args: Any, **kwargs: Any) -> None:
        return None

    def record_exception(self, *args: Any, **kwargs: Any) -> None:
        return None


class _NoOpTracer:
    @contextlib.contextmanager
    def start_as_current_span(self, name: str, **kwargs: Any) -> Iterator[_NoOpSpan]:  # noqa: ARG002
        yield _NoOpSpan()


_noop_tracer_instance: _NoOpTracer | None = None


def get_tracer() -> Any:
    global _noop_tracer_instance
    try:
        from opentelemetry import trace

        return trace.get_tracer(INSTRUMENTATION_NAME, INSTRUMENTATION_VERSION)
    except ImportError:
        if _noop_tracer_instance is None:
            _noop_tracer_instance = _NoOpTracer()
        return _noop_tracer_instance


def root_run_attributes(*, run_id: str, graph_id: str, nesting_depth: int) -> dict[str, Any]:
    return {
        "graph_caster.run_id": run_id,
        "graph_caster.graph_id": graph_id,
        "graph_caster.nesting_depth": nesting_depth,
    }


def finalize_root_run_span(root_span: Any, ctx: dict[str, Any]) -> None:
    if root_span is None:
        return
    try:
        from opentelemetry.trace import Status, StatusCode
    except ImportError:
        return
    if ctx.get("_run_success") or ctx.get("_run_cancelled") or ctx.get("_run_partial_stop"):
        root_span.set_status(Status(StatusCode.OK))
    else:
        root_span.set_status(Status(StatusCode.ERROR))


def mark_current_span_error(description: str | None = None) -> None:
    """Set ERROR on the current span if it exists and is recording (no-op without SDK / outside span)."""
    try:
        from opentelemetry import trace
        from opentelemetry.trace import Status, StatusCode
    except ImportError:
        return
    span = trace.get_current_span()
    recording = getattr(span, "is_recording", None)
    if not callable(recording) or not recording():
        return
    desc = (description or "").strip() or None
    span.set_status(Status(StatusCode.ERROR, desc))


def _span_kind_internal() -> Any:
    try:
        from opentelemetry.trace import SpanKind

        return SpanKind.INTERNAL
    except ImportError:
        return None


@contextlib.contextmanager
def node_visit_span(
    tracer: Any,
    *,
    run_id: str,
    graph_id: str,
    node_id: str,
    node_type: str,
) -> Iterator[Any]:
    attrs = {
        "graph_caster.run_id": run_id,
        "graph_caster.graph_id": graph_id,
        "graph_caster.node_id": node_id,
        "graph_caster.node_type": node_type,
    }
    kind = _span_kind_internal()
    kwargs: dict[str, Any] = {"attributes": attrs}
    if kind is not None:
        kwargs["kind"] = kind
    with tracer.start_as_current_span("gc.node", **kwargs) as span:
        try:
            yield span
        except BaseException as exc:
            rec = getattr(span, "record_exception", None)
            if callable(rec):
                rec(exc)
            raise
