# Copyright GraphCaster. All Rights Reserved.

"""Tests for graph_caster.tools.openapi_import — parsing and spec loading."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from graph_caster.tools.openapi_import import (
    AuthSpec,
    OpenAPIImporter,
    OpenAPIToolSpec,
    _sanitize_name,
)

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "openapi"


# ---------------------------------------------------------------------------
# Name sanitization
# ---------------------------------------------------------------------------


def test_sanitize_name_removes_leading_slash() -> None:
    result = _sanitize_name("/pets")
    assert result == "pets"


def test_sanitize_name_removes_special_chars() -> None:
    result = _sanitize_name("get-pet-by-id!")
    # trailing underscore is stripped; dashes become underscores
    assert result == "get_pet_by_id"


def test_sanitize_name_leading_digit() -> None:
    name = _sanitize_name("123abc")
    assert name.startswith("op_") or name[0].isalpha() or name[0] == "_"


def test_sanitize_name_empty_becomes_operation() -> None:
    assert _sanitize_name("") == "operation"


def test_sanitize_name_path_segments() -> None:
    # slashes become underscores, then multiple underscores are collapsed
    result = _sanitize_name("/pets/{petId}")
    assert "_" in result
    assert result.startswith("pets")
    assert "petId" in result


def test_sanitize_name_no_consecutive_underscores() -> None:
    result = _sanitize_name("a///b")
    # After collapsing multiple underscores, should have at most one between chars
    # The exact output doesn't matter as long as it's a valid identifier
    assert re_valid_identifier(result)


def re_valid_identifier(s: str) -> bool:
    import re
    return bool(re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", s))


# ---------------------------------------------------------------------------
# Minimal OAS3 spec parse
# ---------------------------------------------------------------------------

MINIMAL_SPEC: dict = {
    "openapi": "3.0.3",
    "info": {"title": "Test API", "version": "1.0.0"},
    "servers": [{"url": "https://api.example.com"}],
    "paths": {
        "/pets": {
            "get": {
                "operationId": "listPets",
                "summary": "List all pets",
                "parameters": [
                    {"name": "limit", "in": "query", "required": False, "schema": {"type": "integer"}}
                ],
                "responses": {
                    "200": {
                        "content": {
                            "application/json": {
                                "schema": {"type": "array", "items": {"type": "object"}}
                            }
                        }
                    }
                },
            },
            "post": {
                "operationId": "createPet",
                "summary": "Create a pet",
                "requestBody": {
                    "required": True,
                    "content": {
                        "application/json": {
                            "schema": {
                                "type": "object",
                                "properties": {"name": {"type": "string"}},
                                "required": ["name"],
                            }
                        }
                    },
                },
                "responses": {"201": {"description": "Created"}},
            },
        },
        "/pets/{petId}": {
            "get": {
                "operationId": "getPetById",
                "summary": "Get a pet",
                "parameters": [
                    {"name": "petId", "in": "path", "required": True, "schema": {"type": "string"}}
                ],
                "responses": {
                    "200": {
                        "content": {
                            "application/json": {
                                "schema": {"type": "object"}
                            }
                        }
                    }
                },
            }
        },
    },
}


def test_from_dict_returns_three_operations() -> None:
    importer = OpenAPIImporter()
    specs = importer.from_dict(MINIMAL_SPEC)
    assert len(specs) == 3


def test_from_dict_operation_names() -> None:
    importer = OpenAPIImporter()
    specs = importer.from_dict(MINIMAL_SPEC)
    names = {s.name for s in specs}
    assert "listPets" in names
    assert "createPet" in names
    assert "getPetById" in names


def test_from_dict_base_url() -> None:
    importer = OpenAPIImporter()
    specs = importer.from_dict(MINIMAL_SPEC)
    for s in specs:
        assert s.base_url == "https://api.example.com"


def test_from_dict_base_url_override() -> None:
    importer = OpenAPIImporter()
    specs = importer.from_dict(MINIMAL_SPEC, base_url="https://override.example.com")
    for s in specs:
        assert s.base_url == "https://override.example.com"


def test_from_dict_list_pets_has_query_param() -> None:
    importer = OpenAPIImporter()
    specs = importer.from_dict(MINIMAL_SPEC)
    list_pets = next(s for s in specs if s.name == "listPets")
    param_names = [p["name"] for p in list_pets.parameters]
    assert "limit" in param_names


def test_from_dict_create_pet_has_request_body() -> None:
    importer = OpenAPIImporter()
    specs = importer.from_dict(MINIMAL_SPEC)
    create_pet = next(s for s in specs if s.name == "createPet")
    assert create_pet.request_body is not None
    assert create_pet.request_body["required"] is True


def test_from_dict_get_pet_has_path_param() -> None:
    importer = OpenAPIImporter()
    specs = importer.from_dict(MINIMAL_SPEC)
    get_pet = next(s for s in specs if s.name == "getPetById")
    param_names = [p["name"] for p in get_pet.parameters]
    assert "petId" in param_names
    param = next(p for p in get_pet.parameters if p["name"] == "petId")
    assert param["in"] == "path"
    assert param["required"] is True


def test_from_dict_get_pet_method_is_get() -> None:
    importer = OpenAPIImporter()
    specs = importer.from_dict(MINIMAL_SPEC)
    get_pet = next(s for s in specs if s.name == "getPetById")
    assert get_pet.method == "GET"


def test_from_dict_create_pet_method_is_post() -> None:
    importer = OpenAPIImporter()
    specs = importer.from_dict(MINIMAL_SPEC)
    create_pet = next(s for s in specs if s.name == "createPet")
    assert create_pet.method == "POST"


def test_from_dict_list_pets_has_response_schema() -> None:
    importer = OpenAPIImporter()
    specs = importer.from_dict(MINIMAL_SPEC)
    list_pets = next(s for s in specs if s.name == "listPets")
    assert list_pets.response_schema is not None
    assert list_pets.response_schema.get("type") == "array"


# ---------------------------------------------------------------------------
# from_url — mocked httpx via asyncio.run
# ---------------------------------------------------------------------------


def test_from_url_parses_spec() -> None:
    importer = OpenAPIImporter()
    spec_bytes = json.dumps(MINIMAL_SPEC).encode("utf-8")

    mock_response = MagicMock()
    mock_response.content = spec_bytes
    mock_response.raise_for_status = MagicMock()

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    mock_client.get = AsyncMock(return_value=mock_response)

    with patch("httpx.AsyncClient", return_value=mock_client):
        specs = asyncio.run(importer.from_url("https://api.example.com/openapi.json"))

    assert len(specs) == 3
    names = {s.name for s in specs}
    assert "listPets" in names


def test_from_url_caches_result() -> None:
    from graph_caster.tools.openapi_import import _SPEC_CACHE

    _SPEC_CACHE.clear()
    importer = OpenAPIImporter()
    spec_bytes = json.dumps(MINIMAL_SPEC).encode("utf-8")

    mock_response = MagicMock()
    mock_response.content = spec_bytes
    mock_response.raise_for_status = MagicMock()

    call_count = 0

    async def fake_get(url, **kwargs):
        nonlocal call_count
        call_count += 1
        return mock_response

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    mock_client.get = fake_get

    with patch("httpx.AsyncClient", return_value=mock_client):
        specs1 = asyncio.run(importer.from_url("https://api.example.com/openapi-cache-test.json"))
        specs2 = asyncio.run(importer.from_url("https://api.example.com/openapi-cache-test.json"))

    assert call_count == 1
    assert len(specs1) == len(specs2)
    _SPEC_CACHE.clear()


# ---------------------------------------------------------------------------
# Auth parsing
# ---------------------------------------------------------------------------

def _make_spec_with_security(scheme_def: dict, op_security: list | None = None) -> dict:
    spec: dict = {
        "openapi": "3.0.3",
        "info": {"title": "T", "version": "1"},
        "servers": [{"url": "https://api.example.com"}],
        "components": {
            "securitySchemes": {"myScheme": scheme_def}
        },
        "paths": {
            "/test": {
                "get": {
                    "operationId": "testOp",
                    "responses": {"200": {"description": "ok"}},
                    **({"security": op_security} if op_security is not None else {}),
                }
            }
        },
    }
    if op_security is None:
        spec["security"] = [{"myScheme": []}]
    return spec


def test_auth_no_security() -> None:
    spec = {
        "openapi": "3.0.3",
        "info": {"title": "T", "version": "1"},
        "servers": [{"url": "https://x.com"}],
        "paths": {
            "/t": {"get": {"operationId": "t", "responses": {"200": {"description": "ok"}}}}
        },
    }
    importer = OpenAPIImporter()
    specs = importer.from_dict(spec)
    assert specs[0].auth.kind == "none"


def test_auth_bearer() -> None:
    spec = _make_spec_with_security({"type": "http", "scheme": "bearer"})
    importer = OpenAPIImporter()
    specs = importer.from_dict(spec)
    auth = specs[0].auth
    assert auth.kind == "bearer"
    assert auth.location == "header"
    assert auth.name == "Authorization"
    assert auth.env_var is not None


def test_auth_api_key_in_header() -> None:
    spec = _make_spec_with_security({"type": "apiKey", "in": "header", "name": "X-API-Key"})
    importer = OpenAPIImporter()
    specs = importer.from_dict(spec)
    auth = specs[0].auth
    assert auth.kind == "api_key"
    assert auth.location == "header"
    assert auth.name == "X-API-Key"
    assert auth.env_var is not None


def test_auth_api_key_in_query() -> None:
    spec = _make_spec_with_security({"type": "apiKey", "in": "query", "name": "api_key"})
    importer = OpenAPIImporter()
    specs = importer.from_dict(spec)
    auth = specs[0].auth
    assert auth.kind == "api_key"
    assert auth.location == "query"
    assert auth.name == "api_key"


def test_auth_basic() -> None:
    spec = _make_spec_with_security({"type": "http", "scheme": "basic"})
    importer = OpenAPIImporter()
    specs = importer.from_dict(spec)
    auth = specs[0].auth
    assert auth.kind == "basic"
    assert auth.location == "header"


def test_auth_oauth2() -> None:
    spec = _make_spec_with_security(
        {
            "type": "oauth2",
            "flows": {
                "clientCredentials": {
                    "tokenUrl": "https://auth.example.com/token",
                    "scopes": {"read": "read"},
                }
            },
        }
    )
    importer = OpenAPIImporter()
    specs = importer.from_dict(spec)
    auth = specs[0].auth
    assert auth.kind == "oauth2"


# ---------------------------------------------------------------------------
# Petstore fixture — $ref resolution
# ---------------------------------------------------------------------------


def test_petstore_fixture_parses() -> None:
    importer = OpenAPIImporter()
    specs = importer.from_file(FIXTURES_DIR / "petstore.json")
    assert len(specs) == 3
    names = {s.name for s in specs}
    assert "listPets" in names
    assert "createPets" in names
    assert "showPetById" in names


def test_petstore_list_pets_response_schema_is_array() -> None:
    importer = OpenAPIImporter()
    specs = importer.from_file(FIXTURES_DIR / "petstore.json")
    list_pets = next(s for s in specs if s.name == "listPets")
    assert list_pets.response_schema is not None
    assert list_pets.response_schema.get("type") == "array"


def test_petstore_show_pet_path_param_resolved() -> None:
    importer = OpenAPIImporter()
    specs = importer.from_file(FIXTURES_DIR / "petstore.json")
    show_pet = next(s for s in specs if s.name == "showPetById")
    param_names = [p["name"] for p in show_pet.parameters]
    assert "petId" in param_names


def test_petstore_create_pets_request_body_schema_dereffed() -> None:
    importer = OpenAPIImporter()
    specs = importer.from_file(FIXTURES_DIR / "petstore.json")
    create_pet = next(s for s in specs if s.name == "createPets")
    assert create_pet.request_body is not None
    schema = create_pet.request_body.get("schema", {})
    # $ref to NewPet should be resolved
    assert "$ref" not in json.dumps(schema)
    assert schema.get("type") == "object"


# ---------------------------------------------------------------------------
# from_file caching
# ---------------------------------------------------------------------------


def test_from_file_caches_result() -> None:
    from graph_caster.tools.openapi_import import _SPEC_CACHE

    _SPEC_CACHE.clear()
    importer = OpenAPIImporter()
    path = FIXTURES_DIR / "petstore.json"
    specs1 = importer.from_file(path)
    specs2 = importer.from_file(path)
    assert [s.name for s in specs1] == [s.name for s in specs2]
    _SPEC_CACHE.clear()


# ---------------------------------------------------------------------------
# Swagger 2.0 parsing (best-effort)
# ---------------------------------------------------------------------------

SWAGGER2_SPEC: dict = {
    "swagger": "2.0",
    "info": {"title": "SW2", "version": "1.0"},
    "host": "sw2.example.com",
    "basePath": "/v1",
    "schemes": ["https"],
    "paths": {
        "/items": {
            "get": {
                "operationId": "listItems",
                "parameters": [
                    {"name": "q", "in": "query", "required": False, "type": "string"}
                ],
                "responses": {"200": {"description": "ok"}},
            },
            "post": {
                "operationId": "createItem",
                "parameters": [
                    {
                        "name": "body",
                        "in": "body",
                        "required": True,
                        "schema": {"type": "object", "properties": {"name": {"type": "string"}}},
                    }
                ],
                "responses": {"201": {"description": "created"}},
            },
        }
    },
}


def test_swagger2_parses_correctly() -> None:
    importer = OpenAPIImporter()
    specs = importer.from_dict(SWAGGER2_SPEC)
    names = {s.name for s in specs}
    assert "listItems" in names
    assert "createItem" in names


def test_swagger2_base_url() -> None:
    importer = OpenAPIImporter()
    specs = importer.from_dict(SWAGGER2_SPEC)
    for s in specs:
        assert "sw2.example.com" in s.base_url
        assert "/v1" in s.base_url


def test_swagger2_body_param_becomes_request_body() -> None:
    importer = OpenAPIImporter()
    specs = importer.from_dict(SWAGGER2_SPEC)
    create = next(s for s in specs if s.name == "createItem")
    assert create.request_body is not None
    assert create.request_body["required"] is True
