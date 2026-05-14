# Copyright GraphCaster. All Rights Reserved.

"""Tests for graph_caster.rag.citations (F61 — Citation injection)."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from graph_caster.llm.provider import (
    ChatMessage,
    ChatResponse,
    ModelProvider,
    TokenUsage,
)
from graph_caster.rag.citations import (
    Citation,
    CitedResponse,
    build_citation_prompt,
    build_context_block,
    cited_query,
    parse_citations,
)
from graph_caster.rag.dataset import Dataset
from graph_caster.rag.retrieval import RetrievalConfig, RetrievalMode, RetrievalResult

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_result(
    chunk_id: str = "c1",
    doc_id: str = "d1",
    text: str = "Some chunk text",
    score: float = 0.9,
    source: str = "doc1.pdf",
    page: int | None = None,
    section: str | None = None,
    extra_meta: dict | None = None,
) -> RetrievalResult:
    meta: dict = {"source": source, "doc_id": doc_id}
    if page is not None:
        meta["page"] = page
    if section is not None:
        meta["section"] = section
    if extra_meta:
        meta.update(extra_meta)
    return RetrievalResult(
        chunk_id=chunk_id,
        doc_id=doc_id,
        text=text,
        score=score,
        metadata=meta,
    )


# ---------------------------------------------------------------------------
# build_context_block
# ---------------------------------------------------------------------------


def test_context_block_empty():
    assert build_context_block([]) == ""


def test_context_block_single_result():
    r = _make_result(text="Alpha beta gamma", source="notes.txt")
    block = build_context_block([r])
    assert block.startswith("[1]")
    assert "source: notes.txt" in block
    assert "Alpha beta gamma" in block


def test_context_block_multiple_results():
    r1 = _make_result(chunk_id="c1", text="First chunk", source="a.pdf", page=3)
    r2 = _make_result(chunk_id="c2", text="Second chunk", source="b.pdf")
    block = build_context_block([r1, r2])
    lines = block.splitlines()
    assert len(lines) == 2
    assert lines[0].startswith("[1]")
    assert "page: 3" in lines[0]
    assert lines[1].startswith("[2]")
    assert "page:" not in lines[1]


def test_context_block_numbering_order():
    results = [_make_result(chunk_id=f"c{i}", text=f"Chunk {i}") for i in range(1, 6)]
    block = build_context_block(results)
    for n in range(1, 6):
        assert f"[{n}]" in block


def test_context_block_long_text_is_excerpted():
    long_text = "X" * 400
    r = _make_result(text=long_text)
    block = build_context_block([r])
    # Should be truncated — excerpt max 300 chars + ellipsis
    assert "…" in block


def test_context_block_with_page():
    r = _make_result(source="report.pdf", page=7)
    block = build_context_block([r])
    assert "page: 7" in block


# ---------------------------------------------------------------------------
# build_citation_prompt
# ---------------------------------------------------------------------------


def test_build_citation_prompt_returns_two_messages():
    r = _make_result()
    msgs = build_citation_prompt("What is X?", [r])
    assert len(msgs) == 2
    assert msgs[0].role == "system"
    assert msgs[1].role == "user"


def test_build_citation_prompt_system_contains_instructions():
    r = _make_result()
    msgs = build_citation_prompt("What is X?", [r])
    system_text = msgs[0].content
    assert "[citation:N]" in system_text
    assert "citation" in system_text.lower()


def test_build_citation_prompt_user_contains_context_and_query():
    r = _make_result(text="Relevant information here.", source="test.txt")
    msgs = build_citation_prompt("Explain this.", [r])
    user_text = msgs[1].content
    assert "[1]" in user_text
    assert "test.txt" in user_text
    assert "Explain this." in user_text


def test_build_citation_prompt_system_prefix():
    r = _make_result()
    msgs = build_citation_prompt("Q?", [r], system_prompt_prefix="You are an expert.")
    assert msgs[0].content.startswith("You are an expert.")
    assert "[citation:N]" in msgs[0].content


def test_build_citation_prompt_empty_results():
    msgs = build_citation_prompt("Question?", [])
    assert len(msgs) == 2
    user_text = msgs[1].content
    assert "Question?" in user_text


# ---------------------------------------------------------------------------
# parse_citations — basic matching
# ---------------------------------------------------------------------------


def test_parse_citations_two_matches():
    r1 = _make_result(chunk_id="c1", text="Alpha info", source="doc1.pdf")
    r2 = _make_result(chunk_id="c2", text="Beta info", source="url.com")
    response = "A is X [citation:1]. B is Y [citation:2]."
    result = parse_citations(response, [r1, r2])

    assert result.text == response
    assert result.raw_response == response
    assert len(result.citations) == 2
    assert result.unmatched_citations == []

    assert result.citations[0].index == 1
    assert result.citations[0].chunk_id == "c1"
    assert result.citations[0].source == "doc1.pdf"

    assert result.citations[1].index == 2
    assert result.citations[1].chunk_id == "c2"
    assert result.citations[1].source == "url.com"


def test_parse_citations_unmatched_index():
    r1 = _make_result(chunk_id="c1")
    response = "Something [citation:99]."
    result = parse_citations(response, [r1])
    assert result.citations == []
    assert result.unmatched_citations == [99]


def test_parse_citations_no_markers():
    r1 = _make_result()
    response = "No citations here."
    result = parse_citations(response, [r1])
    assert result.citations == []
    assert result.unmatched_citations == []


def test_parse_citations_dedup_same_chunk():
    r1 = _make_result(chunk_id="c1", text="Info A", source="a.txt")
    response = "See [citation:1] and also [citation:1] again."
    result = parse_citations(response, [r1])
    # Same index appears twice: should yield only one Citation entry
    assert len(result.citations) == 1
    assert result.citations[0].index == 1


def test_parse_citations_preserves_text():
    r1 = _make_result()
    response = "Answer with [citation:1] inline."
    result = parse_citations(response, [r1])
    assert result.text == response


def test_parse_citations_strict_no_bare_brackets():
    r1 = _make_result(chunk_id="c1")
    response = "See [1] for details."
    result = parse_citations(response, [r1], strict=True)
    # Bare [1] should NOT be matched in strict mode
    assert result.citations == []
    assert result.unmatched_citations == []


def test_parse_citations_permissive_bare_brackets():
    r1 = _make_result(chunk_id="c1", text="Info", source="src.txt")
    response = "See [1] for details."
    result = parse_citations(response, [r1], strict=False)
    assert len(result.citations) == 1
    assert result.citations[0].index == 1


def test_parse_citations_with_space_in_marker():
    r1 = _make_result(chunk_id="c1", text="Data", source="x.pdf", page=2)
    response = "See [citation: 1]."
    result = parse_citations(response, [r1])
    assert len(result.citations) == 1
    assert result.citations[0].page == 2


def test_parse_citations_metadata_page_section():
    r1 = _make_result(chunk_id="c1", text="Content", source="doc.pdf", page=5, section="Intro")
    response = "[citation:1]"
    result = parse_citations(response, [r1])
    assert result.citations[0].page == 5
    assert result.citations[0].section == "Intro"


def test_parse_citations_score_propagated():
    r1 = _make_result(chunk_id="c1", score=0.75)
    response = "[citation:1]"
    result = parse_citations(response, [r1])
    assert result.citations[0].score == pytest.approx(0.75)


# ---------------------------------------------------------------------------
# cited_query end-to-end with mock provider
# ---------------------------------------------------------------------------


class MockProvider(ModelProvider):
    name = "mock"

    def __init__(self, fixed_response: str) -> None:
        self._fixed_response = fixed_response
        self.calls: list[dict] = []

    async def chat(
        self,
        model: str,
        messages: list[ChatMessage],
        *,
        tools=None,
        temperature=None,
        max_tokens=None,
        stream: bool = False,
    ) -> ChatResponse:
        self.calls.append({"model": model, "messages": messages})
        return ChatResponse(
            content=self._fixed_response,
            tool_calls=[],
            usage=TokenUsage(prompt_tokens=20, completion_tokens=10, total_tokens=30),
            finish_reason="stop",
        )

    async def list_models(self) -> list[str]:
        return ["mock-v1"]


@pytest.fixture()
def workspace(tmp_path: Path) -> Path:
    return tmp_path


@pytest.fixture()
def dataset_with_docs(workspace: Path) -> Dataset:
    ds = Dataset.create(workspace, "TestDS")
    asyncio.run(ds.add_document("doc1.pdf", "The capital of France is Paris."))
    asyncio.run(ds.add_document("doc2.pdf", "Python is a programming language."))
    asyncio.run(ds.add_document("url.com", "GraphCaster supports RAG natively."))
    return ds


def test_cited_query_returns_cited_response(dataset_with_docs: Dataset) -> None:
    provider = MockProvider("Paris is the capital [citation:1]. Python helps [citation:2].")
    result = asyncio.run(
        cited_query(
            dataset_with_docs,
            "What is the capital of France?",
            provider=provider,
            model="mock-v1",
            retrieval_config=RetrievalConfig(top_k=3),
        )
    )
    assert isinstance(result, CitedResponse)
    assert len(provider.calls) == 1
    assert provider.calls[0]["model"] == "mock-v1"


def test_cited_query_citations_resolved(dataset_with_docs: Dataset) -> None:
    provider = MockProvider(
        "Answer: France [citation:1], Python [citation:2], RAG [citation:3]."
    )
    result = asyncio.run(
        cited_query(
            dataset_with_docs,
            "Tell me everything",
            provider=provider,
            model="mock-v1",
            retrieval_config=RetrievalConfig(top_k=3),
        )
    )
    assert len(result.citations) == 3
    assert result.citations[0].index == 1
    assert result.citations[1].index == 2
    assert result.citations[2].index == 3


def test_cited_query_unmatched_citation(dataset_with_docs: Dataset) -> None:
    provider = MockProvider("This references [citation:99].")
    result = asyncio.run(
        cited_query(
            dataset_with_docs,
            "Query",
            provider=provider,
            model="mock-v1",
            retrieval_config=RetrievalConfig(top_k=3),
        )
    )
    assert 99 in result.unmatched_citations
    assert result.citations == []


def test_cited_query_empty_dataset(workspace: Path) -> None:
    ds = Dataset.create(workspace, "EmptyDS")
    provider = MockProvider("No context available.")
    result = asyncio.run(
        cited_query(
            ds,
            "Any question",
            provider=provider,
            model="mock-v1",
        )
    )
    # Empty dataset → no retrieval results → empty CitedResponse (provider not called)
    assert result.citations == []
    assert result.unmatched_citations == []
    assert len(provider.calls) == 0


def test_cited_query_system_prefix(dataset_with_docs: Dataset) -> None:
    provider = MockProvider("[citation:1]")
    asyncio.run(
        cited_query(
            dataset_with_docs,
            "Q",
            provider=provider,
            model="mock-v1",
            retrieval_config=RetrievalConfig(top_k=2),
            system_prompt_prefix="You are a helpful expert.",
        )
    )
    system_msg = provider.calls[0]["messages"][0]
    assert system_msg.role == "system"
    assert "You are a helpful expert." in system_msg.content


# ---------------------------------------------------------------------------
# cited_query 5-line example (3 citations)
# ---------------------------------------------------------------------------


def test_cited_query_five_line_example(workspace: Path) -> None:
    """Demonstrates cited_query producing 3 citations — the 5-line example.

    Example:
        dataset = Dataset.create(workspace, "Demo")
        await dataset.add_document("notes.txt", "Paris is the capital of France.")
        await dataset.add_document("wiki.pdf", "Python was created by Guido van Rossum.")
        await dataset.add_document("blog.md", "GraphCaster is a workflow engine.")
        result = await cited_query(dataset, "Give me 3 facts", provider=provider, model="mock")
        # result.citations has 3 items: notes.txt, wiki.pdf, blog.md
    """
    ds = Dataset.create(workspace, "Demo")
    asyncio.run(ds.add_document("notes.txt", "Paris is the capital of France."))
    asyncio.run(ds.add_document("wiki.pdf", "Python was created by Guido van Rossum."))
    asyncio.run(ds.add_document("blog.md", "GraphCaster is a workflow engine."))

    provider = MockProvider(
        "France [citation:1], Python [citation:2], GraphCaster [citation:3]."
    )
    result = asyncio.run(
        cited_query(
            ds,
            "Give me 3 facts",
            provider=provider,
            model="mock-v1",
            retrieval_config=RetrievalConfig(top_k=3),
        )
    )

    assert len(result.citations) == 3
    assert result.citations[0].index == 1
    assert result.citations[1].index == 2
    assert result.citations[2].index == 3
    assert result.unmatched_citations == []
    # Verify source metadata flows through
    sources = {c.source for c in result.citations}
    assert sources == {"notes.txt", "wiki.pdf", "blog.md"}
