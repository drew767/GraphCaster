# Copyright GraphCaster. All Rights Reserved.

"""Tests for F64 built-in tool implementations."""

from __future__ import annotations

import json
import math
import uuid as _uuid_mod

import httpx
import pytest


# ---------------------------------------------------------------------------
# Calculator
# ---------------------------------------------------------------------------

class TestCalc:
    @pytest.mark.anyio
    async def test_addition(self):
        from graph_caster.tools.builtin.calculator import calc
        assert await calc("2+2") == pytest.approx(4.0)

    @pytest.mark.anyio
    async def test_complex_expression(self):
        from graph_caster.tools.builtin.calculator import calc
        assert await calc("(1+2)*3") == pytest.approx(9.0)

    @pytest.mark.anyio
    async def test_math_sqrt(self):
        from graph_caster.tools.builtin.calculator import calc
        assert await calc("math.sqrt(16)") == pytest.approx(4.0)

    @pytest.mark.anyio
    async def test_math_pi_constant(self):
        from graph_caster.tools.builtin.calculator import calc
        result = await calc("math.pi")
        assert result == pytest.approx(math.pi)

    @pytest.mark.anyio
    async def test_math_pow(self):
        from graph_caster.tools.builtin.calculator import calc
        assert await calc("math.pow(2, 10)") == pytest.approx(1024.0)

    @pytest.mark.anyio
    async def test_modulo(self):
        from graph_caster.tools.builtin.calculator import calc
        assert await calc("10 % 3") == pytest.approx(1.0)

    @pytest.mark.anyio
    async def test_exponent_operator(self):
        from graph_caster.tools.builtin.calculator import calc
        assert await calc("2 ** 8") == pytest.approx(256.0)

    @pytest.mark.anyio
    async def test_floor_division(self):
        from graph_caster.tools.builtin.calculator import calc
        assert await calc("7 // 2") == pytest.approx(3.0)

    @pytest.mark.anyio
    async def test_unary_minus(self):
        from graph_caster.tools.builtin.calculator import calc
        assert await calc("-5 + 3") == pytest.approx(-2.0)

    @pytest.mark.anyio
    async def test_rejects_dunder_import(self):
        from graph_caster.tools.builtin.calculator import calc
        with pytest.raises(ValueError):
            await calc("__import__('os')")

    @pytest.mark.anyio
    async def test_rejects_arbitrary_name(self):
        from graph_caster.tools.builtin.calculator import calc
        with pytest.raises(ValueError):
            await calc("x + 1")

    @pytest.mark.anyio
    async def test_rejects_arbitrary_function_call(self):
        from graph_caster.tools.builtin.calculator import calc
        with pytest.raises(ValueError):
            await calc("open('file')")

    @pytest.mark.anyio
    async def test_rejects_string_literal(self):
        from graph_caster.tools.builtin.calculator import calc
        with pytest.raises(ValueError):
            await calc("'hello'")

    @pytest.mark.anyio
    async def test_rejects_non_math_attribute(self):
        from graph_caster.tools.builtin.calculator import calc
        with pytest.raises(ValueError):
            await calc("os.getcwd")

    @pytest.mark.anyio
    async def test_rejects_empty(self):
        from graph_caster.tools.builtin.calculator import calc
        with pytest.raises(ValueError):
            await calc("")

    @pytest.mark.anyio
    async def test_rejects_syntax_error(self):
        from graph_caster.tools.builtin.calculator import calc
        with pytest.raises(ValueError):
            await calc("2 +* 3")


# ---------------------------------------------------------------------------
# Regex extract
# ---------------------------------------------------------------------------

class TestRegexExtract:
    @pytest.mark.anyio
    async def test_basic_match(self):
        from graph_caster.tools.builtin.regex_extract import regex_extract
        result = await regex_extract("hello world", r"\w+")
        assert result == "hello"

    @pytest.mark.anyio
    async def test_no_match_returns_empty(self):
        from graph_caster.tools.builtin.regex_extract import regex_extract
        result = await regex_extract("abc", r"\d+")
        assert result == ""

    @pytest.mark.anyio
    async def test_all_true(self):
        from graph_caster.tools.builtin.regex_extract import regex_extract
        result = await regex_extract("cat bat rat", r"\wat", all=True)
        assert result == ["cat", "bat", "rat"]

    @pytest.mark.anyio
    async def test_capture_group(self):
        from graph_caster.tools.builtin.regex_extract import regex_extract
        result = await regex_extract("2026-05-12", r"(\d{4})-(\d{2})-(\d{2})", group=1)
        assert result == "2026"

    @pytest.mark.anyio
    async def test_all_with_capture_group(self):
        from graph_caster.tools.builtin.regex_extract import regex_extract
        result = await regex_extract("foo=1 bar=2", r"(\w+)=\d", group=1, all=True)
        assert result == ["foo", "bar"]

    @pytest.mark.anyio
    async def test_all_no_match(self):
        from graph_caster.tools.builtin.regex_extract import regex_extract
        result = await regex_extract("no digits here", r"\d+", all=True)
        assert result == []


# ---------------------------------------------------------------------------
# JSON parse
# ---------------------------------------------------------------------------

class TestJsonParse:
    @pytest.mark.anyio
    async def test_simple_parse(self):
        from graph_caster.tools.builtin.json_parse import json_parse
        result = await json_parse('{"a": 1, "b": [2, 3]}')
        assert result == {"a": 1, "b": [2, 3]}

    @pytest.mark.anyio
    async def test_jq_path_dict_key(self):
        from graph_caster.tools.builtin.json_parse import json_parse
        result = await json_parse('{"foo": {"bar": 42}}', jq_path=".foo.bar")
        assert result == 42

    @pytest.mark.anyio
    async def test_jq_path_list_index(self):
        from graph_caster.tools.builtin.json_parse import json_parse
        result = await json_parse('{"items": [10, 20, 30]}', jq_path=".items[1]")
        assert result == 20

    @pytest.mark.anyio
    async def test_jq_path_nested(self):
        from graph_caster.tools.builtin.json_parse import json_parse
        data = json.dumps({"results": [{"name": "Alice"}, {"name": "Bob"}]})
        result = await json_parse(data, jq_path=".results[0].name")
        assert result == "Alice"

    @pytest.mark.anyio
    async def test_jq_path_negative_index(self):
        from graph_caster.tools.builtin.json_parse import json_parse
        result = await json_parse('[1, 2, 3]', jq_path="[-1]")
        assert result == 3

    @pytest.mark.anyio
    async def test_invalid_json_raises(self):
        from graph_caster.tools.builtin.json_parse import json_parse
        with pytest.raises(ValueError):
            await json_parse("not json")

    @pytest.mark.anyio
    async def test_missing_key_raises(self):
        from graph_caster.tools.builtin.json_parse import json_parse
        with pytest.raises(KeyError):
            await json_parse('{"a": 1}', jq_path=".b")

    @pytest.mark.anyio
    async def test_no_path(self):
        from graph_caster.tools.builtin.json_parse import json_parse
        result = await json_parse('[1, 2, 3]')
        assert result == [1, 2, 3]


# ---------------------------------------------------------------------------
# Time now
# ---------------------------------------------------------------------------

class TestTimeNow:
    @pytest.mark.anyio
    async def test_iso_format_parseable(self):
        import datetime
        from graph_caster.tools.builtin.time_now import time_now
        result = await time_now(timezone="UTC", format="iso")
        assert isinstance(result, str)
        dt = datetime.datetime.fromisoformat(result)
        assert dt.tzinfo is not None

    @pytest.mark.anyio
    async def test_unix_format_is_integer_string(self):
        from graph_caster.tools.builtin.time_now import time_now
        result = await time_now(format="unix")
        assert result.isdigit()
        assert int(result) > 1_700_000_000

    @pytest.mark.anyio
    async def test_rfc2822_format_shape(self):
        import re
        from graph_caster.tools.builtin.time_now import time_now
        result = await time_now(format="rfc2822")
        assert re.match(r"\w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} [+-]\d{4}", result)

    @pytest.mark.anyio
    async def test_default_format_is_iso(self):
        import datetime
        from graph_caster.tools.builtin.time_now import time_now
        result = await time_now()
        datetime.datetime.fromisoformat(result)

    @pytest.mark.anyio
    async def test_unknown_timezone_falls_back(self):
        from graph_caster.tools.builtin.time_now import time_now
        result = await time_now(timezone="NotATimezone/Fake", format="unix")
        assert result.isdigit()


# ---------------------------------------------------------------------------
# Base64
# ---------------------------------------------------------------------------

class TestBase64:
    @pytest.mark.anyio
    async def test_encode_decode_roundtrip(self):
        from graph_caster.tools.builtin.base64_tool import b64_encode, b64_decode
        original = "Hello, GraphCaster!"
        encoded = await b64_encode(original)
        decoded = await b64_decode(encoded)
        assert decoded.decode("utf-8") == original

    @pytest.mark.anyio
    async def test_encode_bytes(self):
        from graph_caster.tools.builtin.base64_tool import b64_encode
        result = await b64_encode(b"\x00\x01\x02")
        assert result == "AAEC"

    @pytest.mark.anyio
    async def test_decode_with_missing_padding(self):
        from graph_caster.tools.builtin.base64_tool import b64_decode
        result = await b64_decode("SGVsbG8")
        assert result == b"Hello"

    @pytest.mark.anyio
    async def test_encode_empty(self):
        from graph_caster.tools.builtin.base64_tool import b64_encode
        assert await b64_encode("") == ""

    @pytest.mark.anyio
    async def test_unicode_string(self):
        from graph_caster.tools.builtin.base64_tool import b64_encode, b64_decode
        original = "Виктор"
        encoded = await b64_encode(original)
        decoded = await b64_decode(encoded)
        assert decoded.decode("utf-8") == original


# ---------------------------------------------------------------------------
# UUID
# ---------------------------------------------------------------------------

class TestUuidNew:
    @pytest.mark.anyio
    async def test_v4_is_valid_uuid(self):
        from graph_caster.tools.builtin.uuid_tool import uuid_new
        result = await uuid_new(version=4)
        u = _uuid_mod.UUID(result)
        assert u.version == 4

    @pytest.mark.anyio
    async def test_v1_is_valid_uuid(self):
        from graph_caster.tools.builtin.uuid_tool import uuid_new
        result = await uuid_new(version=1)
        u = _uuid_mod.UUID(result)
        assert u.version == 1

    @pytest.mark.anyio
    async def test_v3_is_valid_uuid(self):
        from graph_caster.tools.builtin.uuid_tool import uuid_new
        result = await uuid_new(version=3, name="test")
        u = _uuid_mod.UUID(result)
        assert u.version == 3

    @pytest.mark.anyio
    async def test_v5_is_valid_uuid(self):
        from graph_caster.tools.builtin.uuid_tool import uuid_new
        result = await uuid_new(version=5, name="test")
        u = _uuid_mod.UUID(result)
        assert u.version == 5

    @pytest.mark.anyio
    async def test_default_version_is_4(self):
        from graph_caster.tools.builtin.uuid_tool import uuid_new
        result = await uuid_new()
        u = _uuid_mod.UUID(result)
        assert u.version == 4

    @pytest.mark.anyio
    async def test_v3_deterministic(self):
        from graph_caster.tools.builtin.uuid_tool import uuid_new
        r1 = await uuid_new(version=3, name="hello", namespace="dns")
        r2 = await uuid_new(version=3, name="hello", namespace="dns")
        assert r1 == r2

    @pytest.mark.anyio
    async def test_invalid_version_raises(self):
        from graph_caster.tools.builtin.uuid_tool import uuid_new
        with pytest.raises(ValueError):
            await uuid_new(version=99)

    @pytest.mark.anyio
    async def test_unique_v4(self):
        from graph_caster.tools.builtin.uuid_tool import uuid_new
        results = {await uuid_new() for _ in range(10)}
        assert len(results) == 10


# ---------------------------------------------------------------------------
# HTTP GET (mocked)
# ---------------------------------------------------------------------------

class TestHttpGet:
    @pytest.mark.anyio
    async def test_successful_get(self):
        from graph_caster.tools.builtin.http_get import http_get

        transport = httpx.MockTransport(
            lambda req: httpx.Response(200, text="Hello from mock")
        )
        result = await http_get("https://example.com/test", _transport=transport)
        assert result["status"] == 200
        assert "Hello from mock" in result["body"]

    @pytest.mark.anyio
    async def test_404_response(self):
        from graph_caster.tools.builtin.http_get import http_get

        transport = httpx.MockTransport(
            lambda req: httpx.Response(404, text="Not Found")
        )
        result = await http_get("https://example.com/missing", _transport=transport)
        assert result["status"] == 404

    @pytest.mark.anyio
    async def test_empty_url_raises(self):
        from graph_caster.tools.builtin.http_get import http_get
        with pytest.raises(ValueError):
            await http_get("")

    @pytest.mark.anyio
    async def test_custom_headers_forwarded(self):
        from graph_caster.tools.builtin.http_get import http_get

        received_headers: dict = {}

        def handler(req: httpx.Request) -> httpx.Response:
            received_headers.update(dict(req.headers))
            return httpx.Response(200, text="ok")

        transport = httpx.MockTransport(handler)
        await http_get(
            "https://example.com/",
            headers={"X-Custom": "value"},
            _transport=transport,
        )
        assert received_headers.get("x-custom") == "value"


# ---------------------------------------------------------------------------
# Wikipedia (mocked)
# ---------------------------------------------------------------------------

class TestWikipediaSearch:
    def _make_transport(self, titles, summaries, urls):
        def handler(req: httpx.Request) -> httpx.Response:
            payload = json.dumps(["query", titles, summaries, urls])
            return httpx.Response(200, text=payload)
        return httpx.MockTransport(handler)

    @pytest.mark.anyio
    async def test_returns_results(self):
        from graph_caster.tools.builtin.wikipedia import wikipedia_search

        transport = self._make_transport(
            ["Python (programming language)"],
            ["Python is a high-level language."],
            ["https://en.wikipedia.org/wiki/Python_(programming_language)"],
        )
        results = await wikipedia_search("python", _transport=transport)
        assert len(results) == 1
        assert results[0]["title"] == "Python (programming language)"
        assert "Python" in results[0]["summary"]
        assert results[0]["url"].startswith("https://")

    @pytest.mark.anyio
    async def test_empty_results(self):
        from graph_caster.tools.builtin.wikipedia import wikipedia_search

        transport = self._make_transport([], [], [])
        results = await wikipedia_search("xyzzy_nonexistent_q", _transport=transport)
        assert results == []

    @pytest.mark.anyio
    async def test_respects_limit(self):
        from graph_caster.tools.builtin.wikipedia import wikipedia_search

        titles = ["A", "B", "C", "D", "E"]
        transport = self._make_transport(titles, [""] * 5, ["http://x.com"] * 5)
        results = await wikipedia_search("test", limit=2, _transport=transport)
        assert len(results) == 2


# ---------------------------------------------------------------------------
# DuckDuckGo (mocked)
# ---------------------------------------------------------------------------

class TestWebSearch:
    @pytest.mark.anyio
    async def test_returns_results_from_instant_api(self):
        from graph_caster.tools.builtin.duckduckgo import web_search

        payload = json.dumps({
            "Heading": "Python",
            "AbstractURL": "https://python.org",
            "AbstractText": "Python programming language.",
            "RelatedTopics": [
                {
                    "FirstURL": "https://python.org/docs",
                    "Text": "Python docs - Official documentation",
                }
            ],
        })

        def handler(req: httpx.Request) -> httpx.Response:
            return httpx.Response(200, text=payload)

        transport = httpx.MockTransport(handler)
        results = await web_search("python", _transport=transport)
        assert len(results) >= 1
        assert any(r["url"] == "https://python.org" for r in results)

    @pytest.mark.anyio
    async def test_empty_when_no_results(self):
        from graph_caster.tools.builtin.duckduckgo import web_search

        payload = json.dumps({
            "Heading": "",
            "AbstractURL": "",
            "AbstractText": "",
            "RelatedTopics": [],
        })

        def handler(req: httpx.Request) -> httpx.Response:
            return httpx.Response(200, text=payload)

        transport = httpx.MockTransport(handler)
        results = await web_search("xyzzy_nothing", _transport=transport)
        assert results == []


# ---------------------------------------------------------------------------
# Weather (mocked)
# ---------------------------------------------------------------------------

class TestWeather:
    def _make_transport(self):
        def handler(req: httpx.Request) -> httpx.Response:
            if "geocoding" in str(req.url):
                payload = json.dumps({
                    "results": [
                        {
                            "latitude": 48.85,
                            "longitude": 2.35,
                            "name": "Paris",
                            "country": "France",
                        }
                    ]
                })
                return httpx.Response(200, text=payload)
            else:
                payload = json.dumps({
                    "current": {
                        "temperature_2m": 18.5,
                        "relative_humidity_2m": 65,
                        "weathercode": 2,
                        "wind_speed_10m": 12.3,
                    }
                })
                return httpx.Response(200, text=payload)

        return httpx.MockTransport(handler)

    @pytest.mark.anyio
    async def test_returns_expected_fields(self):
        from graph_caster.tools.builtin.weather import weather

        result = await weather("Paris", _transport=self._make_transport())
        assert "temperature" in result
        assert "humidity" in result
        assert "conditions" in result
        assert "wind_speed" in result
        assert result["location"] == "Paris, France"
        assert result["units"] == "metric"

    @pytest.mark.anyio
    async def test_latlon_skips_geocoding(self):
        from graph_caster.tools.builtin.weather import weather

        calls: list[str] = []

        def handler(req: httpx.Request) -> httpx.Response:
            calls.append(str(req.url))
            payload = json.dumps({
                "current": {
                    "temperature_2m": 20.0,
                    "relative_humidity_2m": 50,
                    "weathercode": 0,
                    "wind_speed_10m": 5.0,
                }
            })
            return httpx.Response(200, text=payload)

        transport = httpx.MockTransport(handler)
        result = await weather("48.85,2.35", _transport=transport)
        assert result["temperature"] == 20.0
        assert not any("geocoding" in c for c in calls), "Should not call geocoding for lat,lon"

    @pytest.mark.anyio
    async def test_conditions_decoded(self):
        from graph_caster.tools.builtin.weather import weather

        result = await weather("Paris", _transport=self._make_transport())
        assert result["conditions"] == "Partly cloudy"

    @pytest.mark.anyio
    async def test_location_not_found_raises(self):
        from graph_caster.tools.builtin.weather import weather

        def handler(req: httpx.Request) -> httpx.Response:
            if "geocoding" in str(req.url):
                return httpx.Response(200, text=json.dumps({"results": []}))
            return httpx.Response(200, text="{}")

        transport = httpx.MockTransport(handler)
        with pytest.raises(ValueError, match="Location not found"):
            await weather("Zzz_Unknown_City", _transport=transport)
