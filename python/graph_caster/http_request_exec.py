# Copyright GraphCaster. All Rights Reserved.

"""Backwards-compatible shim. Canonical implementation lives in ``nodes/http_request.py``."""

from graph_caster.nodes import http_request as _impl
from graph_caster.nodes.http_request import (  # noqa: F401
    HttpRequestNode,
    execute_http_request,
    redact_http_request_data_for_execute,
)

# Re-export ``urllib`` so legacy tests that patch ``graph_caster.http_request_exec.urllib.request.urlopen``
# resolve to the canonical implementation module.
urllib = _impl.urllib
