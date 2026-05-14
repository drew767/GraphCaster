# Copyright GraphCaster. All Rights Reserved.

"""Tests for OpenAPIToolNode — end-to-end with mocked HTTP and schema generation."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from graph_caster.nodes.openapi_tool import OpenAPIToolNode
from graph_caster.node_api.registry import get_registered
from graph_caster.node_api.schema_gen import node_data_schema

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "openapi"


def _run(coro):
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------


def test_openapi_tool_node_registered() -> None:
    cls = get_registered("openapi_tool", 1.0)
    assert cls is OpenAPIToolNode


# ---------------------------------------------------------------------------
# Schema generation
# ---------------------------------------------------------------------------


def test_schema_generation() -> None:
    schema = node_data_schema(OpenAPIToolNode)
    assert schema["type"] == "object"
    props = schema["properties"]
    assert "specSource" in props
    assert "operationId" in props
    assert "arguments" in props
    assert "baseUrlOverride" in props
    assert "specSource" in schema.get("required", [])
    assert "operationId" in schema.get("required", [])
    assert "arguments" in schema.get("required", [])


# ---------------------------------------------------------------------------
# Node.run() — end-to-end with file-based spec
# ---------------------------------------------------------------------------


def test_node_run_list_pets_from_file() -> None:
    spec_path = FIXTURES_DIR / "petstore.json"
    pets_response = [{"id": 1, "name": "Buddy", "tag": "dog"}]

    with patch("httpx.AsyncClient") as mock_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.request = AsyncMock(
            return_value=httpx.Response(
                200,
                content=json.dumps(pets_response).encode(),
                headers={"Content-Type": "application/json"},
            )
        )
        mock_cls.return_value = mock_client

        node = OpenAPIToolNode()
        ctx: dict = {}
        result = _run(node.run(
            ctx,
            specSource=str(spec_path),
            operationId="listPets",
            arguments={"limit": "5"},
            baseUrlOverride="",
        ))

    assert result["status"] == 200
    assert isinstance(result["body"], list)
    assert result["body"][0]["name"] == "Buddy"
    assert isinstance(result["headers"], dict)


def test_node_run_show_pet_by_id() -> None:
    spec_path = FIXTURES_DIR / "petstore.json"
    pet_response = {"id": 42, "name": "Rex"}

    with patch("httpx.AsyncClient") as mock_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        captured_urls: list = []

        async def fake_request(method, url, **kwargs):
            captured_urls.append(url)
            return httpx.Response(
                200,
                content=json.dumps(pet_response).encode(),
                headers={"Content-Type": "application/json"},
            )

        mock_client.request = fake_request
        mock_cls.return_value = mock_client

        node = OpenAPIToolNode()
        ctx: dict = {}
        result = _run(node.run(
            ctx,
            specSource=str(spec_path),
            operationId="showPetById",
            arguments={"petId": "42"},
            baseUrlOverride="",
        ))

    assert result["status"] == 200
    assert result["body"]["id"] == 42
    assert any("42" in str(u) for u in captured_urls)


def test_node_run_base_url_override() -> None:
    spec_path = FIXTURES_DIR / "petstore.json"

    with patch("httpx.AsyncClient") as mock_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        captured_urls: list = []

        async def fake_request(method, url, **kwargs):
            captured_urls.append(str(url))
            return httpx.Response(
                200,
                content=b"[]",
                headers={"Content-Type": "application/json"},
            )

        mock_client.request = fake_request
        mock_cls.return_value = mock_client

        node = OpenAPIToolNode()
        ctx: dict = {}
        result = _run(node.run(
            ctx,
            specSource=str(spec_path),
            operationId="listPets",
            arguments={},
            baseUrlOverride="https://custom.override.io/v2",
        ))

    assert result["status"] == 200
    assert any("custom.override.io" in u for u in captured_urls)


def test_node_run_missing_spec_source_raises() -> None:
    node = OpenAPIToolNode()
    ctx: dict = {}
    with pytest.raises(ValueError, match="specSource"):
        _run(node.run(ctx, specSource="", operationId="listPets", arguments={}))


def test_node_run_nonexistent_file_raises() -> None:
    node = OpenAPIToolNode()
    ctx: dict = {}
    with pytest.raises(ValueError, match="not found"):
        _run(node.run(
            ctx,
            specSource="/nonexistent/path/openapi.json",
            operationId="listPets",
            arguments={},
        ))


def test_node_run_unknown_operation_id_raises() -> None:
    spec_path = FIXTURES_DIR / "petstore.json"
    node = OpenAPIToolNode()
    ctx: dict = {}
    with pytest.raises(ValueError, match="not found"):
        _run(node.run(
            ctx,
            specSource=str(spec_path),
            operationId="nonExistentOp",
            arguments={},
        ))


def test_node_run_arguments_as_json_string() -> None:
    spec_path = FIXTURES_DIR / "petstore.json"

    with patch("httpx.AsyncClient") as mock_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.request = AsyncMock(
            return_value=httpx.Response(
                200,
                content=b"[]",
                headers={"Content-Type": "application/json"},
            )
        )
        mock_cls.return_value = mock_client

        node = OpenAPIToolNode()
        ctx: dict = {}
        result = _run(node.run(
            ctx,
            specSource=str(spec_path),
            operationId="listPets",
            arguments='{"limit": "3"}',
        ))

    assert result["status"] == 200
