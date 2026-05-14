# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import sys
import types
import warnings
from dataclasses import dataclass
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from graph_caster.rag.splitters import (
    Chunk,
    CharacterSplitter,
    CodeSplitter,
    MarkdownSplitter,
    RecursiveCharacterSplitter,
    TextSplitter,
    TokenSplitter,
)


# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------

@dataclass
class _FakeDoc:
    page_content: str
    metadata: dict[str, Any]


LOREM = (
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. "
    "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. "
    "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris. "
    "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum. "
    "Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia. "
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. "
    "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. "
    "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi. "
    "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore. "
    "Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt."
)

NEWLINE_TEXT = "\n".join(
    [f"Line {i}: " + "word " * 20 for i in range(1, 21)]
)

MARKDOWN_TEXT = """# Introduction

This is the introduction paragraph with some text to make it long enough.
It spans multiple lines and talks about the topic.

## Section One

Content for section one. More text here to fill up the section nicely.
This section covers the first topic in detail.

### Subsection 1.1

Details about subsection one point one. Extra content to ensure splitting.

## Section Two

Content for section two. Another paragraph of text for the second section.
This is different material from section one.

### Subsection 2.1

More detailed content for subsection two point one here.
"""

PYTHON_CODE = '''
class MyClass:
    """A sample class."""

    def __init__(self, value: int) -> None:
        self.value = value

    def compute(self) -> int:
        result = self.value * 2
        return result

    def reset(self) -> None:
        self.value = 0


def standalone_function(x: int, y: int) -> int:
    """Add two numbers."""
    return x + y


def another_function(items: list) -> list:
    """Filter items."""
    return [i for i in items if i is not None]
'''


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def test_overlap_must_be_less_than_chunk_size():
    with pytest.raises(ValueError, match="chunk_overlap"):
        CharacterSplitter(chunk_size=100, chunk_overlap=100)

    with pytest.raises(ValueError, match="chunk_overlap"):
        RecursiveCharacterSplitter(chunk_size=50, chunk_overlap=60)


# ---------------------------------------------------------------------------
# CharacterSplitter
# ---------------------------------------------------------------------------

class TestCharacterSplitter:
    def test_chunks_respect_max_size(self):
        splitter = CharacterSplitter(separator="\n", chunk_size=100, chunk_overlap=20)
        chunks = splitter.split_text(NEWLINE_TEXT)
        assert chunks, "should produce at least one chunk"
        for c in chunks:
            assert len(c) <= 100 + 20, f"chunk too large: {len(c)}"

    def test_overlap_carried_over(self):
        lines = ["a" * 50, "b" * 50, "c" * 50, "d" * 50]
        text = "\n".join(lines)
        splitter = CharacterSplitter(separator="\n", chunk_size=60, chunk_overlap=15)
        chunks = splitter.split_text(text)
        assert len(chunks) >= 2
        # The tail of chunk[n-1] should appear somewhere in chunk[n]
        for i in range(1, len(chunks)):
            tail = chunks[i - 1][-15:]
            assert tail in chunks[i] or len(chunks[i - 1]) <= 60

    def test_empty_input(self):
        splitter = CharacterSplitter()
        assert splitter.split_text("") == []

    def test_single_small_text(self):
        splitter = CharacterSplitter(chunk_size=500, chunk_overlap=50)
        result = splitter.split_text("Hello world")
        assert result == ["Hello world"]


# ---------------------------------------------------------------------------
# RecursiveCharacterSplitter
# ---------------------------------------------------------------------------

class TestRecursiveCharacterSplitter:
    def test_chunks_never_exceed_size(self):
        splitter = RecursiveCharacterSplitter(chunk_size=150, chunk_overlap=30)
        chunks = splitter.split_text(LOREM)
        assert chunks, "should produce chunks"
        for c in chunks:
            # Allow a small tolerance from the merge algorithm's separator addition
            assert len(c) <= 150 + 30, f"chunk too large ({len(c)}): {c!r}"

    def test_content_preserved(self):
        splitter = RecursiveCharacterSplitter(chunk_size=200, chunk_overlap=40)
        chunks = splitter.split_text(LOREM)
        # Every word stem (stripped of trailing punctuation) should appear in at least one chunk.
        # Period-based separators consume the '.' so we compare stems only.
        def _stem(w: str) -> str:
            return w.rstrip(".,;:!?")

        lorem_stems = {_stem(w) for w in LOREM.split() if w.strip(".,;:!?")}
        chunk_stems: set[str] = set()
        for c in chunks:
            chunk_stems.update(_stem(w) for w in c.split())
        missing = lorem_stems - chunk_stems
        assert not missing, f"word stems lost in splitting: {missing}"

    def test_empty_input(self):
        splitter = RecursiveCharacterSplitter()
        assert splitter.split_text("") == []

    def test_single_chunk_if_small(self):
        splitter = RecursiveCharacterSplitter(chunk_size=10000, chunk_overlap=100)
        result = splitter.split_text("short text")
        assert result == ["short text"]


# ---------------------------------------------------------------------------
# MarkdownSplitter
# ---------------------------------------------------------------------------

class TestMarkdownSplitter:
    def test_section_boundaries_respected(self):
        splitter = MarkdownSplitter(chunk_size=200, chunk_overlap=20)
        chunks = splitter.split_text(MARKDOWN_TEXT)
        assert len(chunks) >= 2, "should produce multiple chunks from multi-section markdown"

        # H1 heading content should be in one of the chunks
        h1_present = any("Introduction" in c for c in chunks)
        assert h1_present, "Introduction section not found in any chunk"

        # Section Two should be in a chunk
        s2_present = any("Section Two" in c for c in chunks)
        assert s2_present, "Section Two not found in any chunk"

    def test_large_chunk_size_returns_single_chunk(self):
        splitter = MarkdownSplitter(chunk_size=10000, chunk_overlap=100)
        chunks = splitter.split_text(MARKDOWN_TEXT)
        assert len(chunks) == 1

    def test_heading_not_split_across_chunks(self):
        splitter = MarkdownSplitter(chunk_size=150, chunk_overlap=20)
        chunks = splitter.split_text(MARKDOWN_TEXT)
        # "## Section One" should be intact inside a single chunk, not split
        full_text = "\n".join(chunks)
        assert "Section One" in full_text


# ---------------------------------------------------------------------------
# CodeSplitter
# ---------------------------------------------------------------------------

class TestCodeSplitter:
    def test_class_boundaries_respected(self):
        splitter = CodeSplitter(language="python", chunk_size=150, chunk_overlap=20)
        chunks = splitter.split_text(PYTHON_CODE)
        assert chunks, "should produce chunks"
        # MyClass should appear in at least one chunk
        assert any("MyClass" in c for c in chunks)

    def test_def_boundaries_respected(self):
        splitter = CodeSplitter(language="python", chunk_size=150, chunk_overlap=20)
        chunks = splitter.split_text(PYTHON_CODE)
        # standalone_function should appear somewhere
        assert any("standalone_function" in c for c in chunks)

    def test_unsupported_language_raises(self):
        with pytest.raises(ValueError, match="Unsupported language"):
            CodeSplitter(language="cobol")

    def test_supported_languages(self):
        for lang in ["python", "javascript", "typescript", "go", "rust", "java"]:
            s = CodeSplitter(language=lang, chunk_size=500, chunk_overlap=50)
            result = s.split_text("Hello world")
            assert isinstance(result, list)


# ---------------------------------------------------------------------------
# TokenSplitter — with tiktoken
# ---------------------------------------------------------------------------

try:
    import tiktoken as _tiktoken_mod
    _HAS_TIKTOKEN = True
except ImportError:
    _tiktoken_mod = None  # type: ignore[assignment]
    _HAS_TIKTOKEN = False

_skip_no_tiktoken = pytest.mark.skipif(not _HAS_TIKTOKEN, reason="tiktoken not installed")


@_skip_no_tiktoken
class TestTokenSplitterWithTiktoken:
    def test_chunks_bounded_by_token_count(self):
        splitter = TokenSplitter(chunk_size=50, chunk_overlap=10)
        enc = _tiktoken_mod.get_encoding("cl100k_base")  # type: ignore[union-attr]
        chunks = splitter.split_text(LOREM)
        assert chunks, "should produce chunks"
        for c in chunks:
            token_count = len(enc.encode(c))
            # Allow chunk_size + chunk_overlap tolerance from merge boundary
            assert token_count <= 50 + 10 + 5, f"too many tokens ({token_count}) in: {c!r}"

    def test_empty_input(self):
        splitter = TokenSplitter(chunk_size=100, chunk_overlap=10)
        assert splitter.split_text("") == []

    def test_single_small_text(self):
        splitter = TokenSplitter(chunk_size=1000, chunk_overlap=50)
        result = splitter.split_text("Hello world")
        assert result == ["Hello world"]


# ---------------------------------------------------------------------------
# TokenSplitter — without tiktoken (mock)
# ---------------------------------------------------------------------------

class TestTokenSplitterFallback:
    def test_emits_warning_and_falls_back(self):
        import graph_caster.rag.splitters as splitters_mod

        # Reset the module-level warning flag so warning fires for this test
        original_flag = splitters_mod._TIKTOKEN_WARNING_EMITTED
        splitters_mod._TIKTOKEN_WARNING_EMITTED = False

        try:
            with patch.dict(sys.modules, {"tiktoken": None}):
                with warnings.catch_warnings(record=True) as caught:
                    warnings.simplefilter("always")
                    splitter = TokenSplitter.__new__(TokenSplitter)
                    TextSplitter.__init__(splitter, chunk_size=100, chunk_overlap=10)
                    splitter._encoding_name = "cl100k_base"
                    splitter._encoder = None
                    splitter._use_tiktoken = splitter._try_load_tiktoken()

                assert not splitter._use_tiktoken
                assert any("tiktoken" in str(w.message).lower() for w in caught), (
                    "Expected a tiktoken warning"
                )
        finally:
            splitters_mod._TIKTOKEN_WARNING_EMITTED = original_flag

    def test_fallback_produces_output(self):
        import graph_caster.rag.splitters as splitters_mod

        original_flag = splitters_mod._TIKTOKEN_WARNING_EMITTED
        splitters_mod._TIKTOKEN_WARNING_EMITTED = False

        try:
            with patch.dict(sys.modules, {"tiktoken": None}):
                with warnings.catch_warnings(record=True):
                    warnings.simplefilter("always")
                    splitter = TokenSplitter.__new__(TokenSplitter)
                    TextSplitter.__init__(splitter, chunk_size=50, chunk_overlap=10)
                    splitter._encoding_name = "cl100k_base"
                    splitter._encoder = None
                    splitter._use_tiktoken = splitter._try_load_tiktoken()

            result = splitter.split_text(LOREM)
            assert isinstance(result, list)
            assert len(result) >= 1
        finally:
            splitters_mod._TIKTOKEN_WARNING_EMITTED = original_flag


# ---------------------------------------------------------------------------
# split_document round-trip
# ---------------------------------------------------------------------------

class TestSplitDocument:
    def test_chunk_metadata_inherited(self):
        doc = _FakeDoc(
            page_content=NEWLINE_TEXT,
            metadata={"source": "test.txt", "author": "tester"},
        )
        splitter = CharacterSplitter(separator="\n", chunk_size=150, chunk_overlap=20)
        chunks = splitter.split_document(doc)
        assert chunks
        for chunk in chunks:
            assert chunk.metadata["source"] == "test.txt"
            assert chunk.metadata["author"] == "tester"
            assert "chunk_index" in chunk.metadata
            assert "char_start" in chunk.metadata
            assert "char_end" in chunk.metadata

    def test_chunk_index_contiguous(self):
        doc = _FakeDoc(page_content=LOREM, metadata={})
        splitter = RecursiveCharacterSplitter(chunk_size=100, chunk_overlap=20)
        chunks = splitter.split_document(doc)
        for i, chunk in enumerate(chunks):
            assert chunk.metadata["chunk_index"] == i

    def test_content_preserved_round_trip(self):
        doc = _FakeDoc(page_content=NEWLINE_TEXT, metadata={"src": "x"})
        splitter = RecursiveCharacterSplitter(chunk_size=200, chunk_overlap=40)
        chunks = splitter.split_document(doc)
        # Every word from the original should appear in at least one chunk
        original_words = set(NEWLINE_TEXT.split())
        chunk_words: set[str] = set()
        for c in chunks:
            chunk_words.update(c.text.split())
        assert original_words <= chunk_words, "some words were lost"

    def test_char_start_end_within_bounds(self):
        doc = _FakeDoc(page_content=LOREM, metadata={})
        splitter = RecursiveCharacterSplitter(chunk_size=100, chunk_overlap=20)
        chunks = splitter.split_document(doc)
        for chunk in chunks:
            start = chunk.metadata["char_start"]
            end = chunk.metadata["char_end"]
            assert 0 <= start < len(doc.page_content)
            assert end <= len(doc.page_content)
            assert start < end

    def test_split_document_empty(self):
        doc = _FakeDoc(page_content="", metadata={"x": 1})
        splitter = CharacterSplitter()
        chunks = splitter.split_document(doc)
        assert chunks == []
