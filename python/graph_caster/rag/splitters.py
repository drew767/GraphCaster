# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import warnings
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable


@dataclass
class Chunk:
    text: str
    metadata: dict[str, Any] = field(default_factory=dict)


@runtime_checkable
class _Document(Protocol):
    page_content: str
    metadata: dict[str, Any]


class TextSplitter(ABC):
    def __init__(self, *, chunk_size: int = 1000, chunk_overlap: int = 200) -> None:
        if chunk_overlap >= chunk_size:
            raise ValueError(
                f"chunk_overlap ({chunk_overlap}) must be less than chunk_size ({chunk_size})"
            )
        self._chunk_size = chunk_size
        self._chunk_overlap = chunk_overlap

    @abstractmethod
    def split_text(self, text: str) -> list[str]:
        raise NotImplementedError

    def split_document(self, doc: _Document) -> list[Chunk]:
        texts = self.split_text(doc.page_content)
        base_meta = dict(doc.metadata)
        chunks: list[Chunk] = []
        pos = 0
        for idx, text in enumerate(texts):
            char_start = doc.page_content.find(text, pos)
            if char_start == -1:
                char_start = pos
            char_end = char_start + len(text)
            meta = {
                **base_meta,
                "chunk_index": idx,
                "char_start": char_start,
                "char_end": char_end,
            }
            chunks.append(Chunk(text=text, metadata=meta))
            pos = char_start
        return chunks


def _merge_splits(splits: list[str], separator: str, chunk_size: int, chunk_overlap: int) -> list[str]:
    """Merge a list of small splits into chunks respecting chunk_size, with overlap."""
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    sep_len = len(separator)

    for split in splits:
        split_len = len(split)
        added_len = split_len if not current else split_len + sep_len

        if current_len + added_len > chunk_size and current:
            merged = separator.join(current)
            if merged.strip():
                chunks.append(merged)
            # pop from front until we fit the overlap
            while current and current_len > chunk_overlap:
                removed = current.pop(0)
                current_len -= len(removed) + (sep_len if current else 0)

        current.append(split)
        current_len = sum(len(s) for s in current) + sep_len * max(0, len(current) - 1)

    if current:
        merged = separator.join(current)
        if merged.strip():
            chunks.append(merged)

    return chunks


class CharacterSplitter(TextSplitter):
    """Single-separator splitter (default separator: newline)."""

    def __init__(
        self,
        *,
        separator: str = "\n",
        chunk_size: int = 1000,
        chunk_overlap: int = 200,
    ) -> None:
        super().__init__(chunk_size=chunk_size, chunk_overlap=chunk_overlap)
        self._separator = separator

    def split_text(self, text: str) -> list[str]:
        if not text:
            return []
        sep = self._separator
        if sep and sep in text:
            raw_splits = text.split(sep)
        else:
            raw_splits = [text]

        good_splits = [s for s in raw_splits if s.strip()]
        return _merge_splits(good_splits, sep, self._chunk_size, self._chunk_overlap)


class RecursiveCharacterSplitter(TextSplitter):
    """Tries separators in order; recursively re-splits oversized chunks with next separator."""

    _DEFAULT_SEPARATORS = ["\n\n", "\n", ". ", " ", ""]

    def __init__(
        self,
        *,
        separators: list[str] | None = None,
        chunk_size: int = 1000,
        chunk_overlap: int = 200,
    ) -> None:
        super().__init__(chunk_size=chunk_size, chunk_overlap=chunk_overlap)
        self._separators = separators if separators is not None else list(self._DEFAULT_SEPARATORS)

    def _split_text_with_separators(self, text: str, separators: list[str]) -> list[str]:
        if not text:
            return []

        separator = separators[0]
        remaining_separators = separators[1:]

        if separator == "":
            # Character-level split
            splits = list(text)
        elif separator in text:
            splits = text.split(separator)
        else:
            # separator not found — try next level
            if remaining_separators:
                return self._split_text_with_separators(text, remaining_separators)
            return [text]

        good_splits: list[str] = []
        for s in splits:
            if not s:
                continue
            if len(s) <= self._chunk_size:
                good_splits.append(s)
            else:
                if remaining_separators:
                    sub = self._split_text_with_separators(s, remaining_separators)
                    good_splits.extend(sub)
                else:
                    good_splits.append(s)

        return _merge_splits(good_splits, separator, self._chunk_size, self._chunk_overlap)

    def split_text(self, text: str) -> list[str]:
        return self._split_text_with_separators(text, self._separators)


class MarkdownSplitter(RecursiveCharacterSplitter):
    """Splits on Markdown heading boundaries first, then falls back to paragraph/line."""

    _MARKDOWN_SEPARATORS = ["\n# ", "\n## ", "\n### ", "\n\n", "\n", " ", ""]

    def __init__(self, *, chunk_size: int = 1000, chunk_overlap: int = 200) -> None:
        super().__init__(
            separators=self._MARKDOWN_SEPARATORS,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
        )


_LANGUAGE_SEPARATORS: dict[str, list[str]] = {
    "python": ["\nclass ", "\ndef ", "\n\n", "\n", " ", ""],
    "javascript": ["\nfunction ", "\nconst ", "\nlet ", "\nvar ", "\nclass ", "\n\n", "\n", " ", ""],
    "typescript": ["\nfunction ", "\nconst ", "\nlet ", "\nvar ", "\nclass ", "\ninterface ", "\ntype ", "\n\n", "\n", " ", ""],
    "go": ["\nfunc ", "\ntype ", "\nvar ", "\nconst ", "\n\n", "\n", " ", ""],
    "rust": ["\nfn ", "\nstruct ", "\nimpl ", "\ntrait ", "\nenum ", "\n\n", "\n", " ", ""],
    "java": ["\nclass ", "\npublic ", "\nprivate ", "\nprotected ", "\nvoid ", "\n\n", "\n", " ", ""],
}


class CodeSplitter(RecursiveCharacterSplitter):
    """Language-aware splitter using per-language separator sets."""

    def __init__(
        self,
        *,
        language: str = "python",
        chunk_size: int = 1000,
        chunk_overlap: int = 200,
    ) -> None:
        lang = language.lower()
        if lang not in _LANGUAGE_SEPARATORS:
            raise ValueError(
                f"Unsupported language '{language}'. "
                f"Supported: {sorted(_LANGUAGE_SEPARATORS)}"
            )
        super().__init__(
            separators=_LANGUAGE_SEPARATORS[lang],
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
        )
        self._language = lang


_TIKTOKEN_WARNING_EMITTED = False


class TokenSplitter(TextSplitter):
    """Token-aware splitter using tiktoken (cl100k_base by default).

    Falls back to character splitting (chunk_size * 4 bytes) if tiktoken is not installed,
    emitting a one-time warning.
    """

    def __init__(
        self,
        *,
        encoding: str = "cl100k_base",
        chunk_size: int = 1000,
        chunk_overlap: int = 200,
    ) -> None:
        super().__init__(chunk_size=chunk_size, chunk_overlap=chunk_overlap)
        self._encoding_name = encoding
        self._encoder: Any = None
        self._use_tiktoken = self._try_load_tiktoken()

    def _try_load_tiktoken(self) -> bool:
        global _TIKTOKEN_WARNING_EMITTED
        try:
            import tiktoken  # noqa: PLC0415

            self._encoder = tiktoken.get_encoding(self._encoding_name)
            return True
        except ImportError:
            if not _TIKTOKEN_WARNING_EMITTED:
                warnings.warn(
                    "tiktoken is not installed. TokenSplitter falling back to character "
                    "splitting (chunk_size * 4 chars). Install with: "
                    "pip install 'graph-caster[rag-tokens]'",
                    stacklevel=3,
                )
                _TIKTOKEN_WARNING_EMITTED = True
            return False

    def split_text(self, text: str) -> list[str]:
        if not text:
            return []

        if not self._use_tiktoken:
            # Fallback: character-based at chunk_size * 4
            char_size = self._chunk_size * 4
            char_overlap = self._chunk_overlap * 4
            splitter = CharacterSplitter(
                separator=" ",
                chunk_size=char_size,
                chunk_overlap=char_overlap,
            )
            return splitter.split_text(text)

        tokens = self._encoder.encode(text)
        chunks: list[str] = []
        start = 0
        while start < len(tokens):
            end = min(start + self._chunk_size, len(tokens))
            chunk_tokens = tokens[start:end]
            chunk_text = self._encoder.decode(chunk_tokens)
            if chunk_text.strip():
                chunks.append(chunk_text)
            if end >= len(tokens):
                break
            start += self._chunk_size - self._chunk_overlap

        return chunks
