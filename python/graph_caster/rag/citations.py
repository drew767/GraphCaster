# Copyright GraphCaster. All Rights Reserved.

"""F61 — Citation injection: prompt-engineering helper and post-processing for LLM responses.

Workflow:
1. ``build_context_block`` formats retrieved chunks into a numbered reference block.
2. ``build_citation_prompt`` builds a system+user message list instructing the LLM to cite.
3. After the LLM responds, ``parse_citations`` links [citation:N] markers back to chunks.
4. ``cited_query`` is a one-call async helper combining all three steps.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from graph_caster.llm.provider import ChatMessage
from graph_caster.rag.retrieval import RetrievalConfig, RetrievalResult

if TYPE_CHECKING:
    from graph_caster.llm.provider import ModelProvider
    from graph_caster.rag.dataset import Dataset

# ---------------------------------------------------------------------------
# Public data classes
# ---------------------------------------------------------------------------

_EXCERPT_MAX = 300  # characters shown in Citation.text


@dataclass
class Citation:
    """One resolved citation linking an LLM marker back to a retrieved chunk."""

    index: int
    chunk_id: str
    doc_id: str
    source: str
    text: str
    score: float
    page: int | None = None
    section: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "index": self.index,
            "chunk_id": self.chunk_id,
            "doc_id": self.doc_id,
            "source": self.source,
            "text": self.text,
            "score": self.score,
            "page": self.page,
            "section": self.section,
        }


@dataclass
class CitedResponse:
    """LLM response with citations resolved to chunk metadata."""

    text: str
    citations: list[Citation]
    raw_response: str
    unmatched_citations: list[int] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "citations": [c.to_dict() for c in self.citations],
            "raw_response": self.raw_response,
            "unmatched_citations": self.unmatched_citations,
        }


# ---------------------------------------------------------------------------
# Context block builder
# ---------------------------------------------------------------------------

_STRICT_PATTERN = re.compile(r"\[citation:\s*(\d+)\]")
_PERMISSIVE_PATTERN = re.compile(r"\[citation:\s*(\d+)\]|\[(\d+)\]")


def _excerpt(text: str, max_chars: int = _EXCERPT_MAX) -> str:
    text = text.strip()
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rstrip() + "…"


def _source_from_result(result: RetrievalResult) -> str:
    meta = result.metadata or {}
    return str(meta.get("source", result.doc_id or result.chunk_id))


def _page_from_result(result: RetrievalResult) -> int | None:
    meta = result.metadata or {}
    val = meta.get("page")
    if val is None:
        return None
    try:
        return int(val)
    except (TypeError, ValueError):
        return None


def _section_from_result(result: RetrievalResult) -> str | None:
    meta = result.metadata or {}
    val = meta.get("section")
    return str(val) if val is not None else None


def build_context_block(results: list[RetrievalResult]) -> str:
    """Return a numbered reference block for insertion into an LLM prompt.

    Format per entry:
      [N] (source: path.txt, page: 3) chunk text …
      [N] (source: url.com) chunk text …

    Numbers are 1-based in the same order as ``results``.
    """
    if not results:
        return ""
    lines: list[str] = []
    for idx, r in enumerate(results, start=1):
        source = _source_from_result(r)
        page = _page_from_result(r)
        meta_parts = [f"source: {source}"]
        if page is not None:
            meta_parts.append(f"page: {page}")
        meta_str = ", ".join(meta_parts)
        excerpt = _excerpt(r.text)
        lines.append(f"[{idx}] ({meta_str}) {excerpt}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Prompt builder
# ---------------------------------------------------------------------------

_SYSTEM_INSTRUCTIONS = (
    "You are a helpful assistant that answers questions based on the provided context.\n"
    "When you reference information from the context, you MUST include a citation marker "
    "immediately after the relevant statement using the format [citation:N], where N is the "
    "number of the referenced context chunk (e.g. [citation:1], [citation:2]).\n"
    "Use only the numbered context chunks provided. Do not fabricate citations."
)

_USER_TEMPLATE = (
    "Context:\n"
    "{context_block}\n\n"
    "Question: {query}"
)


def build_citation_prompt(
    query: str,
    results: list[RetrievalResult],
    *,
    system_prompt_prefix: str = "",
) -> list[ChatMessage]:
    """Return [system, user] ChatMessage list instructing the LLM to use [citation:N] markers.

    ``system_prompt_prefix`` is prepended to the standard citation instructions.
    """
    system_text = _SYSTEM_INSTRUCTIONS
    if system_prompt_prefix:
        system_text = system_prompt_prefix.rstrip() + "\n\n" + system_text

    context_block = build_context_block(results)
    user_text = _USER_TEMPLATE.format(context_block=context_block, query=query)

    return [
        ChatMessage(role="system", content=system_text),
        ChatMessage(role="user", content=user_text),
    ]


# ---------------------------------------------------------------------------
# Citation parser
# ---------------------------------------------------------------------------


def parse_citations(
    response_text: str,
    results: list[RetrievalResult],
    *,
    strict: bool = True,
) -> CitedResponse:
    """Extract [citation:N] markers from ``response_text`` and link to ``results``.

    Parameters
    ----------
    response_text:
        Raw LLM response text containing zero or more citation markers.
    results:
        Ordered list of RetrievalResult (1-based index mapping).
    strict:
        If True (default) only ``[citation:N]`` and ``[citation: N]`` are matched.
        If False, also matches ``[N]`` shorthand.

    Returns
    -------
    CitedResponse with:
    - ``text`` — response_text unchanged (markers preserved for UI rendering).
    - ``citations`` — unique, ordered list of resolved Citation objects.
    - ``raw_response`` — same as text (kept separate for future transforms).
    - ``unmatched_citations`` — indices that appeared but had no corresponding chunk.
    """
    pattern = _STRICT_PATTERN if strict else _PERMISSIVE_PATTERN

    seen_indices: list[int] = []
    for m in pattern.finditer(response_text):
        # group 1 = citation:N form, group 2 = bare [N] form (permissive only)
        raw = m.group(1) if m.group(1) is not None else m.group(2)
        try:
            idx = int(raw)
        except (TypeError, ValueError):
            continue
        if idx not in seen_indices:
            seen_indices.append(idx)

    citations: list[Citation] = []
    unmatched: list[int] = []

    for idx in seen_indices:
        result_idx = idx - 1  # convert to 0-based
        if 0 <= result_idx < len(results):
            r = results[result_idx]
            citations.append(
                Citation(
                    index=idx,
                    chunk_id=r.chunk_id,
                    doc_id=r.doc_id,
                    source=_source_from_result(r),
                    text=_excerpt(r.text),
                    score=r.score,
                    page=_page_from_result(r),
                    section=_section_from_result(r),
                )
            )
        else:
            unmatched.append(idx)

    return CitedResponse(
        text=response_text,
        citations=citations,
        raw_response=response_text,
        unmatched_citations=unmatched,
    )


# ---------------------------------------------------------------------------
# One-call async helper
# ---------------------------------------------------------------------------


async def cited_query(
    dataset: "Dataset",
    query: str,
    *,
    provider: "ModelProvider",
    model: str,
    retrieval_config: RetrievalConfig | None = None,
    system_prompt_prefix: str = "",
    temperature: float = 0.0,
) -> CitedResponse:
    """Retrieve from ``dataset``, build citation prompt, call LLM, parse citations.

    Parameters
    ----------
    dataset:
        F56 Dataset to retrieve from.
    query:
        Natural-language question.
    provider:
        F50 ModelProvider instance (must implement ``chat``).
    model:
        Model identifier passed to ``provider.chat``.
    retrieval_config:
        F60 RetrievalConfig; defaults to vector top-5.
    system_prompt_prefix:
        Optional text prepended before citation system instructions.
    temperature:
        Sampling temperature (default 0.0 for determinism).
    """
    cfg = retrieval_config or RetrievalConfig(top_k=5)
    results: list[RetrievalResult] = await dataset.query(query, config=cfg)  # type: ignore[assignment]

    if not results:
        return CitedResponse(
            text="",
            citations=[],
            raw_response="",
            unmatched_citations=[],
        )

    messages = build_citation_prompt(
        query,
        results,
        system_prompt_prefix=system_prompt_prefix,
    )

    from graph_caster.llm.provider import ChatResponse

    response = await provider.chat(
        model,
        messages,
        temperature=temperature,
    )
    if isinstance(response, ChatResponse):
        response_text = response.content
    else:
        # AsyncIterator[ChatStreamChunk] — collect (not expected in normal use)
        chunks = [chunk async for chunk in response]  # type: ignore[union-attr]
        response_text = "".join(c.delta for c in chunks)

    return parse_citations(response_text, results)
