# Copyright GraphCaster. All Rights Reserved.

"""Built-in tool implementations for the GraphCaster tool registry (F64).

Registers all 10 Tier-1 tools into a ToolRegistry instance.
"""

from __future__ import annotations

from graph_caster.tools.registry import ToolRegistry, ToolSpec

from graph_caster.tools.builtin.wikipedia import wikipedia_search
from graph_caster.tools.builtin.duckduckgo import web_search
from graph_caster.tools.builtin.calculator import calc
from graph_caster.tools.builtin.http_get import http_get
from graph_caster.tools.builtin.time_now import time_now
from graph_caster.tools.builtin.regex_extract import regex_extract
from graph_caster.tools.builtin.json_parse import json_parse
from graph_caster.tools.builtin.base64_tool import b64_encode, b64_decode
from graph_caster.tools.builtin.uuid_tool import uuid_new
from graph_caster.tools.builtin.weather import weather

_BUILTIN_SPECS: list[ToolSpec] = [
    ToolSpec(
        name="wikipedia_search",
        display_name="Wikipedia Search",
        description="Search Wikipedia and return article summaries. No API key required.",
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
                "lang": {"type": "string", "default": "en", "description": "Wikipedia language code"},
                "limit": {"type": "integer", "default": 3, "description": "Max results (1–20)"},
            },
            "required": ["query"],
        },
        callable=wikipedia_search,
    ),
    ToolSpec(
        name="web_search",
        display_name="Web Search (DuckDuckGo)",
        description="Search the web via DuckDuckGo and return titles, URLs, and snippets. No API key.",
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
                "max_results": {"type": "integer", "default": 5, "description": "Max results (1–25)"},
                "region": {"type": "string", "default": "us-en", "description": "DuckDuckGo region code"},
            },
            "required": ["query"],
        },
        callable=web_search,
    ),
    ToolSpec(
        name="calc",
        display_name="Calculator",
        description=(
            "Safely evaluate an arithmetic expression. "
            "Supports +,-,*,/,%,**,// and math.* functions (e.g. math.sqrt(16)). "
            "Rejects any unsafe constructs."
        ),
        parameters={
            "type": "object",
            "properties": {
                "expression": {"type": "string", "description": "Arithmetic expression to evaluate"},
            },
            "required": ["expression"],
        },
        callable=calc,
    ),
    ToolSpec(
        name="http_get",
        display_name="HTTP GET",
        description="Perform a read-only HTTP GET request. Returns {status, body}.",
        parameters={
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "Target URL"},
                "headers": {
                    "type": "object",
                    "additionalProperties": {"type": "string"},
                    "description": "Optional request headers",
                },
                "timeout_sec": {"type": "number", "default": 30, "description": "Request timeout in seconds"},
            },
            "required": ["url"],
        },
        callable=http_get,
    ),
    ToolSpec(
        name="time_now",
        display_name="Current Time",
        description="Return the current date/time as a string.",
        parameters={
            "type": "object",
            "properties": {
                "timezone": {"type": "string", "default": "UTC", "description": "IANA timezone name"},
                "format": {
                    "type": "string",
                    "enum": ["iso", "unix", "rfc2822"],
                    "default": "iso",
                    "description": "Output format",
                },
            },
        },
        callable=time_now,
    ),
    ToolSpec(
        name="regex_extract",
        display_name="Regex Extract",
        description="Extract regex matches from text.",
        parameters={
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "Input text"},
                "pattern": {"type": "string", "description": "Regular expression pattern"},
                "group": {"type": "integer", "default": 0, "description": "Capture group index"},
                "all": {"type": "boolean", "default": False, "description": "Return all matches"},
            },
            "required": ["text", "pattern"],
        },
        callable=regex_extract,
    ),
    ToolSpec(
        name="json_parse",
        display_name="JSON Parse",
        description="Parse a JSON string and optionally apply a dot-path filter.",
        parameters={
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "Raw JSON string"},
                "jq_path": {
                    "type": "string",
                    "description": "Optional dot-path filter, e.g. .items[0].name",
                },
            },
            "required": ["text"],
        },
        callable=json_parse,
    ),
    ToolSpec(
        name="b64_encode",
        display_name="Base64 Encode",
        description="Encode a string or bytes as Base64.",
        parameters={
            "type": "object",
            "properties": {
                "data": {"type": "string", "description": "String (UTF-8) to encode"},
            },
            "required": ["data"],
        },
        callable=b64_encode,
    ),
    ToolSpec(
        name="b64_decode",
        display_name="Base64 Decode",
        description="Decode a Base64 string back to bytes (returned as base64 string for JSON transport).",
        parameters={
            "type": "object",
            "properties": {
                "s": {"type": "string", "description": "Base64-encoded string to decode"},
            },
            "required": ["s"],
        },
        callable=b64_decode,
    ),
    ToolSpec(
        name="uuid_new",
        display_name="Generate UUID",
        description="Generate a new UUID (versions 1, 3, 4, or 5).",
        parameters={
            "type": "object",
            "properties": {
                "version": {"type": "integer", "enum": [1, 3, 4, 5], "default": 4},
                "name": {"type": "string", "default": "", "description": "Name string for v3/v5 UUIDs"},
                "namespace": {
                    "type": "string",
                    "enum": ["dns", "url", "oid", "x500"],
                    "default": "dns",
                    "description": "Namespace for v3/v5 UUIDs",
                },
            },
        },
        callable=uuid_new,
    ),
    ToolSpec(
        name="weather",
        display_name="Weather",
        description="Get current weather for a location via Open-Meteo. No API key required.",
        parameters={
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "City name or 'lat,lon' string",
                },
                "units": {
                    "type": "string",
                    "enum": ["metric", "imperial"],
                    "default": "metric",
                    "description": "Temperature and wind speed units",
                },
            },
            "required": ["location"],
        },
        callable=weather,
    ),
]


def register_all(registry: ToolRegistry) -> None:
    """Register all built-in tool specs into *registry*."""
    for spec in _BUILTIN_SPECS:
        registry.register(spec)
