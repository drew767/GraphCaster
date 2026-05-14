# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import os
from typing import Any

import httpx

from graph_caster.rag.embeddings.base import ConfigError, Embedder

_HF_INFERENCE_BASE = "https://api-inference.huggingface.co/pipeline/feature-extraction"


class HuggingFaceEmbedder(Embedder):
    name = "huggingface"
    dim = 768

    def __init__(
        self,
        model: str = "sentence-transformers/all-MiniLM-L6-v2",
        api_key: str | None = None,
        base_url: str = _HF_INFERENCE_BASE,
        timeout: float = 120.0,
    ) -> None:
        self._model = model
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout

    def _resolve_key(self) -> str:
        key = (self._api_key or os.environ.get("HUGGINGFACE_API_KEY") or "").strip()
        if not key:
            raise ConfigError("HuggingFaceEmbedder requires HUGGINGFACE_API_KEY")
        return key

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        key = self._resolve_key()
        url = f"{self._base_url}/{self._model}"
        body = json.dumps({"inputs": texts, "options": {"wait_for_model": True}}, ensure_ascii=False).encode()
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(
                url,
                content=body,
                headers={
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                },
            )
        resp.raise_for_status()
        payload: Any = resp.json()
        return _parse_hf_response(payload, len(texts))


def _parse_hf_response(payload: Any, expected: int) -> list[list[float]]:
    if isinstance(payload, list) and payload and isinstance(payload[0], list):
        if isinstance(payload[0][0], (int, float)):
            return [[float(x) for x in vec] for vec in payload]
        if isinstance(payload[0][0], list):
            return [[float(x) for x in vec[0]] for vec in payload]
    raise ValueError(f"HuggingFaceEmbedder: unexpected response shape (len={len(payload) if isinstance(payload, list) else 'n/a'})")
