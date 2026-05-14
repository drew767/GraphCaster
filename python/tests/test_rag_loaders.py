# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from graph_caster.rag.loaders.base import Document, DocumentLoader
from graph_caster.rag.loaders.csv_loader import CsvLoader
from graph_caster.rag.loaders.json_loader import JsonLoader
from graph_caster.rag.loaders.text import TextLoader

FIXTURES = Path(__file__).parent / "fixtures" / "rag"

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def run(coro):
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# base
# ---------------------------------------------------------------------------


def test_document_dataclass():
    doc = Document(page_content="hello", metadata={"source": "test"})
    assert doc.page_content == "hello"
    assert doc.metadata["source"] == "test"


def test_document_default_metadata():
    doc = Document(page_content="hi")
    assert doc.metadata == {}


def test_document_loader_is_abstract():
    import inspect

    assert inspect.isabstract(DocumentLoader)


# ---------------------------------------------------------------------------
# TextLoader
# ---------------------------------------------------------------------------


def test_text_loader_load():
    docs = run(TextLoader(FIXTURES / "sample.txt").load())
    assert len(docs) == 1
    doc = docs[0]
    assert "GraphCaster" in doc.page_content
    assert doc.metadata["source"].endswith("sample.txt")
    assert doc.metadata["encoding"] == "utf-8"


def test_text_loader_lazy_load():
    async def _collect():
        out = []
        async for doc in TextLoader(FIXTURES / "sample.txt").lazy_load():
            out.append(doc)
        return out

    docs = run(_collect())
    assert len(docs) == 1


def test_text_loader_custom_encoding(tmp_path):
    p = tmp_path / "latin.txt"
    p.write_bytes("caf\xe9".encode("latin-1"))
    docs = run(TextLoader(p, encoding="latin-1").load())
    assert "café" in docs[0].page_content


# ---------------------------------------------------------------------------
# CsvLoader
# ---------------------------------------------------------------------------


def test_csv_loader_row_count():
    docs = run(CsvLoader(FIXTURES / "sample.csv").load())
    assert len(docs) == 3


def test_csv_loader_metadata():
    docs = run(CsvLoader(FIXTURES / "sample.csv").load())
    assert docs[0].metadata["row_idx"] == 0
    assert "name" in docs[0].metadata["columns"]
    assert "description" in docs[0].metadata["columns"]


def test_csv_loader_content_join():
    docs = run(CsvLoader(FIXTURES / "sample.csv").load())
    assert "GraphCaster" in docs[0].page_content


def test_csv_loader_source_column():
    docs = run(CsvLoader(FIXTURES / "sample.csv", source_column="name").load())
    assert docs[0].page_content == "GraphCaster"
    assert docs[1].page_content == "RAG Loader"
    assert docs[2].page_content == "Vector Store"


def test_csv_loader_source_metadata():
    docs = run(CsvLoader(FIXTURES / "sample.csv").load())
    assert str(FIXTURES / "sample.csv") == docs[0].metadata["source"]


# ---------------------------------------------------------------------------
# JsonLoader — .json list
# ---------------------------------------------------------------------------


def test_json_loader_list():
    docs = run(JsonLoader(FIXTURES / "sample.json").load())
    assert len(docs) == 3


def test_json_loader_list_metadata():
    docs = run(JsonLoader(FIXTURES / "sample.json").load())
    assert docs[0].metadata["index"] == 0
    assert docs[2].metadata["index"] == 2
    assert docs[0].metadata["path"] == "."


def test_json_loader_list_content():
    docs = run(JsonLoader(FIXTURES / "sample.json").load())
    data = json.loads(docs[0].page_content)
    assert data["title"] == "Introduction"


def test_json_loader_jq_schema():
    docs = run(JsonLoader(FIXTURES / "sample.json", jq_schema=".body").load())
    assert docs[0].page_content == "This is the introduction section."
    assert docs[1].page_content == "The system uses a graph-based approach."


def test_json_loader_single_object(tmp_path):
    p = tmp_path / "obj.json"
    p.write_text('{"key": "value"}', encoding="utf-8")
    docs = run(JsonLoader(p).load())
    assert len(docs) == 1
    data = json.loads(docs[0].page_content)
    assert data["key"] == "value"


# ---------------------------------------------------------------------------
# JsonLoader — .jsonl
# ---------------------------------------------------------------------------


def test_jsonl_loader_line_count():
    docs = run(JsonLoader(FIXTURES / "sample.jsonl").load())
    assert len(docs) == 3


def test_jsonl_loader_metadata():
    docs = run(JsonLoader(FIXTURES / "sample.jsonl").load())
    assert docs[0].metadata["index"] == 0
    assert docs[1].metadata["index"] == 1


def test_jsonl_loader_content():
    docs = run(JsonLoader(FIXTURES / "sample.jsonl").load())
    d0 = json.loads(docs[0].page_content)
    assert d0["id"] == 1


def test_jsonl_loader_skips_blank_lines(tmp_path):
    p = tmp_path / "sparse.jsonl"
    p.write_text('{"a":1}\n\n{"b":2}\n', encoding="utf-8")
    docs = run(JsonLoader(p).load())
    assert len(docs) == 2


# ---------------------------------------------------------------------------
# PdfLoader — skip if pypdf not installed
# ---------------------------------------------------------------------------

try:
    import pypdf  # noqa: F401

    _HAS_PYPDF = True
except ImportError:
    _HAS_PYPDF = False


@pytest.mark.skipif(not _HAS_PYPDF, reason="pypdf not installed")
def test_pdf_loader_raises_on_missing_file():
    import asyncio

    with pytest.raises(Exception):
        run(TextLoader("/nonexistent/path.pdf").load())


@pytest.mark.skipif(not _HAS_PYPDF, reason="pypdf not installed")
def test_pdf_loader_import_works():
    from graph_caster.rag.loaders.pdf import PdfLoader

    assert PdfLoader is not None


def test_pdf_loader_import_error_without_pypdf(monkeypatch):
    import builtins

    real_import = builtins.__import__

    def mock_import(name, *args, **kwargs):
        if name == "pypdf":
            raise ImportError("mocked missing pypdf")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", mock_import)
    from graph_caster.rag.loaders.pdf import PdfLoader

    loader = PdfLoader("/tmp/fake.pdf")
    with pytest.raises(ImportError, match="pypdf"):
        loader._get_reader()


# ---------------------------------------------------------------------------
# DocxLoader — skip if python-docx not installed
# ---------------------------------------------------------------------------

try:
    import docx  # noqa: F401

    _HAS_DOCX = True
except ImportError:
    _HAS_DOCX = False


@pytest.mark.skipif(not _HAS_DOCX, reason="python-docx not installed")
def test_docx_loader_import_works():
    from graph_caster.rag.loaders.docx import DocxLoader

    assert DocxLoader is not None


def test_docx_loader_import_error_without_docx(monkeypatch):
    import builtins

    real_import = builtins.__import__

    def mock_import(name, *args, **kwargs):
        if name == "docx":
            raise ImportError("mocked missing python-docx")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", mock_import)
    from graph_caster.rag.loaders.docx import DocxLoader

    loader = DocxLoader("/tmp/fake.docx")
    with pytest.raises(ImportError, match="python-docx"):
        loader._get_document()


# ---------------------------------------------------------------------------
# WebLoader — mock transport
# ---------------------------------------------------------------------------

try:
    import httpx  # noqa: F401

    _HAS_HTTPX = True
except ImportError:
    _HAS_HTTPX = False

try:
    import httpx  # noqa: F401
    import bs4  # noqa: F401

    _HAS_WEB = True
except ImportError:
    _HAS_WEB = False


@pytest.mark.skipif(not _HAS_WEB, reason="httpx/beautifulsoup4 not installed")
def test_web_loader_basic():
    import httpx

    html = b"""
    <html>
      <head><title>Test Page</title></head>
      <body><p>Hello from GraphCaster</p></body>
    </html>
    """

    def handler(request):
        return httpx.Response(200, content=html, headers={"content-type": "text/html"})

    transport = httpx.MockTransport(handler)
    loader = WebLoader("http://example.com/page", transport=transport)
    docs = run(loader.load())
    assert len(docs) == 1
    doc = docs[0]
    assert "Hello from GraphCaster" in doc.page_content
    assert doc.metadata["source"] == "http://example.com/page"
    assert doc.metadata["title"] == "Test Page"


@pytest.mark.skipif(not _HAS_WEB, reason="httpx/beautifulsoup4 not installed")
def test_web_loader_css_selector():
    import httpx

    html = b"""
    <html>
      <head><title>CSS Test</title></head>
      <body>
        <div class="main">Main content</div>
        <div class="sidebar">Sidebar</div>
      </body>
    </html>
    """

    def handler(request):
        return httpx.Response(200, content=html, headers={"content-type": "text/html"})

    transport = httpx.MockTransport(handler)
    loader = WebLoader("http://example.com/page", css_selector=".main", transport=transport)
    docs = run(loader.load())
    assert "Main content" in docs[0].page_content
    assert "Sidebar" not in docs[0].page_content


@pytest.mark.skipif(not _HAS_WEB, reason="httpx/beautifulsoup4 not installed")
def test_web_loader_strips_scripts():
    import httpx

    html = b"""
    <html>
      <head><title>Script Test</title></head>
      <body>
        <script>alert('xss')</script>
        <p>Visible text</p>
      </body>
    </html>
    """

    def handler(request):
        return httpx.Response(200, content=html, headers={"content-type": "text/html"})

    transport = httpx.MockTransport(handler)
    docs = run(WebLoader("http://x.com", transport=transport).load())
    assert "alert" not in docs[0].page_content
    assert "Visible text" in docs[0].page_content


# ---------------------------------------------------------------------------
# GitHubLoader — mock transport
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not _HAS_HTTPX, reason="httpx not installed")
def test_github_loader_basic():
    import httpx

    tree_response = {
        "tree": [
            {"path": "README.md", "type": "blob", "sha": "abc"},
            {"path": "src/main.py", "type": "blob", "sha": "def"},
            {"path": "src/", "type": "tree", "sha": "ghi"},
        ]
    }

    contents = {
        "README.md": {
            "encoding": "base64",
            "content": __import__("base64").b64encode(b"# Hello World").decode() + "\n",
        },
        "src/main.py": {
            "encoding": "base64",
            "content": __import__("base64").b64encode(b"print('hi')").decode() + "\n",
        },
    }

    def handler(request):
        url = str(request.url)
        if "/git/trees/" in url:
            return httpx.Response(200, json=tree_response)
        for path, content in contents.items():
            if f"/contents/{path}" in url:
                return httpx.Response(200, json=content)
        return httpx.Response(404, json={"message": "Not Found"})

    transport = httpx.MockTransport(handler)
    loader = GitHubLoader("owner/repo", transport=transport)
    docs = run(loader.load())
    assert len(docs) == 2
    sources = [d.metadata["source"] for d in docs]
    assert any("README.md" in s for s in sources)
    assert any("src/main.py" in s for s in sources)


@pytest.mark.skipif(not _HAS_HTTPX, reason="httpx not installed")
def test_github_loader_file_glob():
    import httpx

    tree_response = {
        "tree": [
            {"path": "README.md", "type": "blob"},
            {"path": "src/main.py", "type": "blob"},
            {"path": "src/utils.py", "type": "blob"},
        ]
    }

    def handler(request):
        url = str(request.url)
        if "/git/trees/" in url:
            return httpx.Response(200, json=tree_response)
        content = __import__("base64").b64encode(b"# python file").decode() + "\n"
        return httpx.Response(200, json={"encoding": "base64", "content": content})

    transport = httpx.MockTransport(handler)
    loader = GitHubLoader("owner/repo", file_glob="*.py", transport=transport)
    docs = run(loader.load())
    assert all(d.metadata["file_path"].endswith(".py") for d in docs)


@pytest.mark.skipif(not _HAS_HTTPX, reason="httpx not installed")
def test_github_loader_path_filter():
    import httpx

    tree_response = {
        "tree": [
            {"path": "README.md", "type": "blob"},
            {"path": "src/main.py", "type": "blob"},
        ]
    }

    def handler(request):
        url = str(request.url)
        if "/git/trees/" in url:
            return httpx.Response(200, json=tree_response)
        content = __import__("base64").b64encode(b"content").decode() + "\n"
        return httpx.Response(200, json={"encoding": "base64", "content": content})

    transport = httpx.MockTransport(handler)
    loader = GitHubLoader("owner/repo", path="src/", transport=transport)
    docs = run(loader.load())
    assert len(docs) == 1
    assert docs[0].metadata["file_path"] == "src/main.py"


# ---------------------------------------------------------------------------
# rag.__init__ exports
# ---------------------------------------------------------------------------


def test_rag_init_exports_loaders():
    from graph_caster.rag import (
        CsvLoader,
        Document,
        DocumentLoader,
        GitHubLoader,
        JsonLoader,
        PdfLoader,
        TextLoader,
        WebLoader,
    )

    assert TextLoader is not None
    assert Document is not None
    assert DocumentLoader is not None
    assert CsvLoader is not None
    assert JsonLoader is not None
    assert PdfLoader is not None
    assert WebLoader is not None
    assert GitHubLoader is not None


# local import for test_github_loader
from graph_caster.rag.loaders.github import GitHubLoader  # noqa: E402
from graph_caster.rag.loaders.web import WebLoader  # noqa: E402
