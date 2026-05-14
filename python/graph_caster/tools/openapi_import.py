# Copyright GraphCaster. All Rights Reserved.

"""OpenAPI / Swagger import — parses a spec and produces callable OpenAPIToolSpec objects.

Supports OpenAPI 3.0, 3.1 (primary) and Swagger 2.0 (best-effort).
HTTP via httpx; no new heavy dependencies.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlencode, urlparse, urlunparse

# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class AuthSpec:
    kind: Literal["none", "bearer", "api_key", "basic", "oauth2"]
    location: Literal["header", "query", "cookie"] | None = None
    name: str | None = None
    env_var: str | None = None


@dataclass
class OpenAPIToolSpec:
    name: str
    summary: str
    description: str
    method: str
    path: str
    base_url: str
    parameters: list[dict]
    request_body: dict | None
    response_schema: dict | None
    auth: AuthSpec
    raw_operation: dict


# ---------------------------------------------------------------------------
# In-memory spec cache
# ---------------------------------------------------------------------------

_CACHE_TTL_SEC: float = float(os.environ.get("GC_OPENAPI_CACHE_TTL_SEC", "300") or "300")

# key -> (specs, timestamp)
_SPEC_CACHE: dict[str, tuple[list[OpenAPIToolSpec], float]] = {}


def _cache_key(identifier: str, content_hash: str) -> str:
    return f"{identifier}:{content_hash}"


def _spec_content_hash(raw: dict) -> str:
    return hashlib.sha256(json.dumps(raw, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:16]


def _cache_get(key: str) -> list[OpenAPIToolSpec] | None:
    entry = _SPEC_CACHE.get(key)
    if entry is None:
        return None
    specs, ts = entry
    if time.monotonic() - ts > _CACHE_TTL_SEC:
        del _SPEC_CACHE[key]
        return None
    return specs


def _cache_put(key: str, specs: list[OpenAPIToolSpec]) -> None:
    _SPEC_CACHE[key] = (specs, time.monotonic())


# ---------------------------------------------------------------------------
# Name sanitisation
# ---------------------------------------------------------------------------

_INVALID_CHARS = re.compile(r"[^a-zA-Z0-9_]")
_MULTI_UNDERSCORE = re.compile(r"_+")


def _sanitize_name(raw: str) -> str:
    """Convert an arbitrary string into a valid Python-style identifier."""
    s = _INVALID_CHARS.sub("_", raw)
    s = _MULTI_UNDERSCORE.sub("_", s)
    s = s.strip("_")
    if not s:
        s = "operation"
    if s[0].isdigit():
        s = "op_" + s
    return s


def _operation_name(method: str, path: str, operation_id: str | None) -> str:
    if operation_id:
        return _sanitize_name(operation_id)
    parts = [method.lower()] + [seg for seg in path.split("/") if seg and not seg.startswith("{")]
    return _sanitize_name("_".join(parts)) or _sanitize_name(f"{method}_{path}")


# ---------------------------------------------------------------------------
# $ref resolution (shallow, within same document)
# ---------------------------------------------------------------------------


def _resolve_ref(ref: str, root: dict) -> dict:
    """Resolve a JSON-pointer $ref within the same document.

    Only handles '#/...' internal references.
    Returns the raw dict at the pointer, or {} on failure.
    """
    if not ref.startswith("#/"):
        return {}
    parts = ref[2:].split("/")
    node: Any = root
    for part in parts:
        part = part.replace("~1", "/").replace("~0", "~")
        if not isinstance(node, dict) or part not in node:
            return {}
        node = node[part]
    return node if isinstance(node, dict) else {}


def _deref(obj: Any, root: dict, depth: int = 0) -> Any:
    """Recursively resolve $ref pointers up to a safe depth."""
    if depth > 8:
        return obj
    if isinstance(obj, dict):
        if "$ref" in obj:
            resolved = _resolve_ref(obj["$ref"], root)
            return _deref(resolved, root, depth + 1)
        return {k: _deref(v, root, depth + 1) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_deref(item, root, depth + 1) for item in obj]
    return obj


# ---------------------------------------------------------------------------
# Auth parsing
# ---------------------------------------------------------------------------


def _parse_auth_from_security_schemes(
    operation: dict,
    global_security: list[dict],
    security_schemes: dict[str, dict],
) -> AuthSpec:
    """Return an AuthSpec by looking at operation-level then global security."""
    op_security: list[dict] = operation.get("security", global_security)
    if not op_security:
        return AuthSpec(kind="none")

    for req in op_security:
        if not req:
            return AuthSpec(kind="none")
        for scheme_name in req:
            scheme = security_schemes.get(scheme_name, {})
            scheme_type = str(scheme.get("type", "")).lower()
            if scheme_type == "http":
                http_scheme = str(scheme.get("scheme", "")).lower()
                if http_scheme == "bearer":
                    env_var = f"GC_{scheme_name.upper()}_TOKEN"
                    return AuthSpec(kind="bearer", location="header", name="Authorization", env_var=env_var)
                if http_scheme == "basic":
                    env_var = f"GC_{scheme_name.upper()}_CREDENTIALS"
                    return AuthSpec(kind="basic", location="header", name="Authorization", env_var=env_var)
            if scheme_type == "apikey":
                loc = str(scheme.get("in", "header")).lower()
                param_name = str(scheme.get("name", "X-Api-Key"))
                env_var = f"GC_{scheme_name.upper()}_KEY"
                return AuthSpec(
                    kind="api_key",
                    location=loc,  # type: ignore[arg-type]
                    name=param_name,
                    env_var=env_var,
                )
            if scheme_type == "oauth2":
                env_var = f"GC_{scheme_name.upper()}_TOKEN"
                return AuthSpec(kind="oauth2", location="header", name="Authorization", env_var=env_var)

    return AuthSpec(kind="none")


# ---------------------------------------------------------------------------
# Base URL extraction
# ---------------------------------------------------------------------------


def _extract_base_url_oas3(spec: dict, override: str | None) -> str:
    if override:
        return override.rstrip("/")
    servers: list[dict] = spec.get("servers", [])
    if servers:
        url = str(servers[0].get("url", "")).rstrip("/")
        if url:
            return url
    return ""


def _extract_base_url_swagger2(spec: dict, override: str | None) -> str:
    if override:
        return override.rstrip("/")
    host = str(spec.get("host", "")).strip()
    base = str(spec.get("basePath", "/")).strip()
    schemes = spec.get("schemes", ["https"])
    scheme = schemes[0] if schemes else "https"
    if host:
        return f"{scheme}://{host}{base}".rstrip("/")
    return base.rstrip("/")


# ---------------------------------------------------------------------------
# Response schema extraction
# ---------------------------------------------------------------------------


def _extract_response_schema(responses: dict, root: dict) -> dict | None:
    for code in ("200", "201", "202", "default"):
        resp = responses.get(code)
        if resp is None:
            continue
        resp = _deref(resp, root)
        content = resp.get("content", {})
        if content:
            for mime, media in content.items():
                if "json" in mime:
                    s = media.get("schema")
                    if s:
                        return _deref(s, root)
        schema = resp.get("schema")
        if schema:
            return _deref(schema, root)
    return None


# ---------------------------------------------------------------------------
# Core parser
# ---------------------------------------------------------------------------


def _parse_oas3(spec: dict, base_url: str | None) -> list[OpenAPIToolSpec]:
    root = spec
    actual_base = _extract_base_url_oas3(spec, base_url)
    global_security: list[dict] = spec.get("security", [])
    security_schemes: dict[str, dict] = (
        spec.get("components", {}).get("securitySchemes", {})
    )

    tools: list[OpenAPIToolSpec] = []
    paths: dict = spec.get("paths", {})

    for path, path_item in paths.items():
        if not isinstance(path_item, dict):
            continue
        path_item = _deref(path_item, root)
        path_level_params: list[dict] = path_item.get("parameters", [])

        for method in ("get", "post", "put", "patch", "delete", "head", "options"):
            operation = path_item.get(method)
            if not isinstance(operation, dict):
                continue
            operation = _deref(operation, root)

            op_id = operation.get("operationId")
            name = _operation_name(method, path, op_id)
            summary = str(operation.get("summary", "")).strip()
            description = str(operation.get("description", "")).strip()

            op_params = operation.get("parameters", [])
            merged_params: list[dict] = []
            seen_names: set[str] = set()
            for p in op_params:
                p = _deref(p, root)
                key = (p.get("in", ""), p.get("name", ""))
                seen_names.add(key)
                merged_params.append(p)
            for p in path_level_params:
                p = _deref(p, root)
                key = (p.get("in", ""), p.get("name", ""))
                if key not in seen_names:
                    merged_params.append(p)

            request_body: dict | None = None
            rb = operation.get("requestBody")
            if rb:
                rb = _deref(rb, root)
                content = rb.get("content", {})
                for mime, media in content.items():
                    if "json" in mime:
                        request_body = {
                            "required": rb.get("required", False),
                            "content_type": mime,
                            "schema": _deref(media.get("schema", {}), root),
                        }
                        break
                if request_body is None and content:
                    first_mime, first_media = next(iter(content.items()))
                    request_body = {
                        "required": rb.get("required", False),
                        "content_type": first_mime,
                        "schema": _deref(first_media.get("schema", {}), root),
                    }

            responses: dict = operation.get("responses", {})
            response_schema = _extract_response_schema(responses, root)

            auth = _parse_auth_from_security_schemes(operation, global_security, security_schemes)

            tools.append(
                OpenAPIToolSpec(
                    name=name,
                    summary=summary,
                    description=description or summary,
                    method=method.upper(),
                    path=path,
                    base_url=actual_base,
                    parameters=merged_params,
                    request_body=request_body,
                    response_schema=response_schema,
                    auth=auth,
                    raw_operation=operation,
                )
            )

    return tools


def _parse_swagger2(spec: dict, base_url: str | None) -> list[OpenAPIToolSpec]:
    root = spec
    actual_base = _extract_base_url_swagger2(spec, base_url)
    global_security: list[dict] = spec.get("security", [])
    security_definitions: dict[str, dict] = spec.get("securityDefinitions", {})
    # Normalise to OAS3 format for auth parsing
    security_schemes: dict[str, dict] = {}
    for name, defn in security_definitions.items():
        t = str(defn.get("type", "")).lower()
        if t == "apikey":
            security_schemes[name] = {"type": "apiKey", "in": defn.get("in", "header"), "name": defn.get("name", "")}
        elif t == "basic":
            security_schemes[name] = {"type": "http", "scheme": "basic"}
        elif t == "oauth2":
            security_schemes[name] = {"type": "oauth2"}
        else:
            security_schemes[name] = defn

    tools: list[OpenAPIToolSpec] = []
    paths: dict = spec.get("paths", {})

    for path, path_item in paths.items():
        if not isinstance(path_item, dict):
            continue
        path_item = _deref(path_item, root)
        path_level_params: list[dict] = path_item.get("parameters", [])

        for method in ("get", "post", "put", "patch", "delete", "head", "options"):
            operation = path_item.get(method)
            if not isinstance(operation, dict):
                continue
            operation = _deref(operation, root)

            op_id = operation.get("operationId")
            name = _operation_name(method, path, op_id)
            summary = str(operation.get("summary", "")).strip()
            description = str(operation.get("description", "")).strip()

            op_params = operation.get("parameters", [])
            merged_params: list[dict] = []
            seen_names: set[str] = set()
            request_body: dict | None = None

            for p in op_params:
                p = _deref(p, root)
                if p.get("in") == "body":
                    schema = _deref(p.get("schema", {}), root)
                    request_body = {
                        "required": p.get("required", False),
                        "content_type": "application/json",
                        "schema": schema,
                    }
                else:
                    key = (p.get("in", ""), p.get("name", ""))
                    seen_names.add(key)
                    merged_params.append(p)

            for p in path_level_params:
                p = _deref(p, root)
                key = (p.get("in", ""), p.get("name", ""))
                if key not in seen_names and p.get("in") != "body":
                    merged_params.append(p)

            responses: dict = operation.get("responses", {})
            response_schema = _extract_response_schema(responses, root)

            auth = _parse_auth_from_security_schemes(operation, global_security, security_schemes)

            tools.append(
                OpenAPIToolSpec(
                    name=name,
                    summary=summary,
                    description=description or summary,
                    method=method.upper(),
                    path=path,
                    base_url=actual_base,
                    parameters=merged_params,
                    request_body=request_body,
                    response_schema=response_schema,
                    auth=auth,
                    raw_operation=operation,
                )
            )

    return tools


# ---------------------------------------------------------------------------
# OpenAPIImporter
# ---------------------------------------------------------------------------


class OpenAPIImporter:
    """Parse OpenAPI 3.x / Swagger 2.0 specs into callable OpenAPIToolSpec lists."""

    def __init__(self) -> None:
        pass

    async def from_url(self, url: str, *, timeout_sec: float = 30.0) -> list[OpenAPIToolSpec]:
        """Fetch an OpenAPI spec from *url* and parse it.

        Uses httpx for the HTTP request.  Raises httpx.HTTPError on failure.
        Results are cached by URL + content hash for GC_OPENAPI_CACHE_TTL_SEC seconds.
        A URL-only preliminary cache key is checked before the HTTP round-trip to
        avoid redundant fetches when the content is already known.
        """
        import httpx

        # Fast path: check URL-only cache key (set after first successful fetch)
        url_only_key = _cache_key(url, "url_only")
        cached = _cache_get(url_only_key)
        if cached is not None:
            return cached

        async with httpx.AsyncClient(timeout=timeout_sec, follow_redirects=True) as client:
            response = await client.get(url)
            response.raise_for_status()
            raw_bytes = response.content

        try:
            spec = json.loads(raw_bytes)
        except json.JSONDecodeError as exc:
            raise ValueError(f"OpenAPI spec at {url!r} is not valid JSON: {exc}") from exc

        content_hash = hashlib.sha256(raw_bytes).hexdigest()[:16]
        cache_key = _cache_key(url, content_hash)
        cached = _cache_get(cache_key)
        if cached is not None:
            _cache_put(url_only_key, cached)
            return cached

        tools = self.from_dict(spec, base_url=None)
        _cache_put(cache_key, tools)
        _cache_put(url_only_key, tools)
        return tools

    def from_dict(self, spec: dict, *, base_url: str | None = None) -> list[OpenAPIToolSpec]:
        """Parse an OpenAPI 3.0/3.1 or Swagger 2.0 spec dict.

        *base_url* overrides whatever is in spec.servers[0].url (OAS3) or
        host/basePath/schemes (Swagger 2.0).
        """
        if not isinstance(spec, dict):
            raise ValueError("OpenAPI spec must be a JSON object (dict)")

        # Determine spec version
        openapi_version = str(spec.get("openapi", "") or spec.get("swagger", ""))
        if openapi_version.startswith("2"):
            return _parse_swagger2(spec, base_url)
        # Default: treat as OAS3
        return _parse_oas3(spec, base_url)

    def from_file(self, path: Path) -> list[OpenAPIToolSpec]:
        """Load and parse an OpenAPI spec from a JSON file on disk.

        Results are cached by path + content hash.
        """
        raw_bytes = Path(path).read_bytes()
        try:
            spec = json.loads(raw_bytes)
        except json.JSONDecodeError as exc:
            raise ValueError(f"OpenAPI spec at {path!r} is not valid JSON: {exc}") from exc

        content_hash = hashlib.sha256(raw_bytes).hexdigest()[:16]
        cache_key = _cache_key(str(path), content_hash)
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

        tools = self.from_dict(spec)
        _cache_put(cache_key, tools)
        return tools


# ---------------------------------------------------------------------------
# Tool invocation
# ---------------------------------------------------------------------------

class SecretsResolverProtocol:
    """Duck-type protocol — any object with as_mapping() -> dict[str, str]."""
    def as_mapping(self) -> dict[str, str]: ...


def _interpolate_path(path: str, path_params: dict[str, str]) -> str:
    """Replace {paramName} in path with values from path_params."""
    def replace(match: re.Match) -> str:
        key = match.group(1)
        if key in path_params:
            from urllib.parse import quote
            return quote(str(path_params[key]), safe="")
        return match.group(0)

    return re.sub(r"\{([^}]+)\}", replace, path)


def _build_url(base_url: str, path: str, path_params: dict[str, str], query_params: dict[str, str]) -> str:
    interpolated = _interpolate_path(path, path_params)
    full = base_url.rstrip("/") + "/" + interpolated.lstrip("/")
    if query_params:
        parsed = urlparse(full)
        existing = parsed.query
        new_qs = urlencode({str(k): str(v) for k, v in query_params.items()})
        combined = f"{existing}&{new_qs}" if existing else new_qs
        full = urlunparse(parsed._replace(query=combined))
    return full


def _get_required_params(spec: OpenAPIToolSpec) -> set[str]:
    required: set[str] = set()
    for p in spec.parameters:
        if p.get("required") and p.get("name"):
            required.add(p["name"])
    if spec.request_body and spec.request_body.get("required"):
        required.add("body")
    return required


async def invoke_openapi_tool(
    spec: OpenAPIToolSpec,
    arguments: dict,
    *,
    secrets_resolver: Any,
    timeout_sec: float = 30.0,
    raise_on_4xx: bool = False,
    transport: Any = None,
) -> dict:
    """Build a request from spec + arguments and execute it via httpx.

    Returns ``{"status": int, "headers": dict, "body": Any}``.

    Parameters
    ----------
    spec:
        An OpenAPIToolSpec describing the operation.
    arguments:
        Dict of argument values.  Path params, query params, headers, cookie
        params and the special key ``"body"`` are dispatched by ``spec.parameters``
        and ``spec.request_body``.
    secrets_resolver:
        Duck-typed object with ``as_mapping() -> dict[str, str]``.  Used to
        resolve auth credentials referenced by ``spec.auth.env_var``.
    timeout_sec:
        HTTP timeout.
    raise_on_4xx:
        If True, raises ValueError on 4xx responses instead of returning them.
    transport:
        Optional httpx transport (for testing with MockTransport).
    """
    import httpx

    # Validate required arguments
    required = _get_required_params(spec)
    missing = required - set(arguments.keys())
    if missing:
        missing_list = ", ".join(sorted(missing))
        raise ValueError(
            f"invoke_openapi_tool: missing required arguments for '{spec.name}': {missing_list}. "
            f"Expected: {sorted(required)}"
        )

    secrets: dict[str, str] = {}
    if secrets_resolver is not None:
        try:
            secrets = dict(secrets_resolver.as_mapping())
        except Exception:
            pass

    # Bucket arguments by parameter location
    path_params: dict[str, str] = {}
    query_params: dict[str, str] = {}
    header_params: dict[str, str] = {}
    cookie_params: dict[str, str] = {}

    for p in spec.parameters:
        name = p.get("name", "")
        location = p.get("in", "query")
        if name not in arguments:
            continue
        val = str(arguments[name])
        if location == "path":
            path_params[name] = val
        elif location == "query":
            query_params[name] = val
        elif location == "header":
            header_params[name] = val
        elif location == "cookie":
            cookie_params[name] = val

    url = _build_url(spec.base_url, spec.path, path_params, query_params)

    # Auth injection
    auth = spec.auth
    if auth.kind == "bearer" or auth.kind == "oauth2":
        token = secrets.get(auth.env_var or "", "") or os.environ.get(auth.env_var or "", "")
        if token:
            header_params["Authorization"] = f"Bearer {token}"
    elif auth.kind == "api_key":
        key_value = secrets.get(auth.env_var or "", "") or os.environ.get(auth.env_var or "", "")
        if key_value and auth.name:
            if auth.location == "header":
                header_params[auth.name] = key_value
            elif auth.location == "query":
                query_params[auth.name] = key_value
            elif auth.location == "cookie":
                cookie_params[auth.name] = key_value
            # Rebuild URL if query param was added
            if auth.location == "query":
                url = _build_url(spec.base_url, spec.path, path_params, query_params)
    elif auth.kind == "basic":
        creds = secrets.get(auth.env_var or "", "") or os.environ.get(auth.env_var or "", "")
        if creds:
            import base64
            encoded = base64.b64encode(creds.encode()).decode()
            header_params["Authorization"] = f"Basic {encoded}"

    # Build body
    content: bytes | None = None
    content_type: str | None = None

    body_value = arguments.get("body")
    if body_value is None and spec.request_body:
        body_schema = spec.request_body.get("schema", {})
        # attempt positional body from arguments if schema has properties
        props = body_schema.get("properties", {})
        body_from_args = {k: arguments[k] for k in props if k in arguments}
        if body_from_args:
            body_value = body_from_args

    if body_value is not None and spec.method not in ("GET", "DELETE", "HEAD"):
        ct = (spec.request_body or {}).get("content_type", "application/json")
        content_type = ct
        if "json" in ct:
            content = json.dumps(body_value).encode("utf-8")
        else:
            content = str(body_value).encode("utf-8")

    if content_type and "content-type" not in {k.lower() for k in header_params}:
        header_params["Content-Type"] = content_type

    # cookies as header
    cookie_header: str | None = None
    if cookie_params:
        cookie_header = "; ".join(f"{k}={v}" for k, v in cookie_params.items())
        if cookie_header:
            header_params["Cookie"] = cookie_header

    # Execute
    client_kwargs: dict[str, Any] = {
        "timeout": timeout_sec,
        "follow_redirects": True,
    }
    if transport is not None:
        client_kwargs["transport"] = transport

    async with httpx.AsyncClient(**client_kwargs) as client:
        response = await client.request(
            method=spec.method,
            url=url,
            headers=header_params,
            content=content,
        )

    resp_headers = dict(response.headers)
    resp_bytes = response.content
    resp_ct = response.headers.get("content-type", "")

    # Parse body
    body: Any
    if "application/json" in resp_ct or resp_ct.endswith("+json"):
        try:
            body = json.loads(resp_bytes)
        except json.JSONDecodeError:
            body = resp_bytes.decode("utf-8", errors="replace")
    else:
        try:
            body = resp_bytes.decode("utf-8", errors="replace")
        except Exception:
            body = None

    if raise_on_4xx and 400 <= response.status_code < 500:
        raise ValueError(
            f"OpenAPI tool '{spec.name}' received {response.status_code}: {body!r}"
        )

    return {
        "status": response.status_code,
        "headers": resp_headers,
        "body": body,
    }
