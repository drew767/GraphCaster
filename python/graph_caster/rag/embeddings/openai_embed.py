# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import os
from typing import Any

import httpx

from graph_caster.rag.embeddings.base import ConfigError, Embedder

_MODEL_DIMS: dict[str, int] = {
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
    "text-embedding-ada-002": 1536,
}


class OpenAIEmbedder(Embedder):
    name = "openai"
    dim = 1536

    def __init__(
        self,
        model: str = "text-embedding-3-small",
        api_key: str | None = None,
        base_url: str = "https://api.openai.com/v1",
        timeout: float = 120.0,
    ) -> None:
        self._model = model
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self.dim = _MODEL_DIMS.get(model, 1536)

    def _resolve_key(self) -> str:
        key = (
            self._api_key
            or os.environ.get("GC_OPENAI_API_KEY")
            or os.environ.get("OPENAI_API_KEY")
            or ""
        ).strip()
        if not key:
            raise ConfigError(
                "OpenAIEmbedder requires GC_OPENAI_API_KEY or OPENAI_API_KEY"
            )
        return key

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        key = self._resolve_key()
        url = f"{self._base_url}/embeddings"
        body = json.dumps({"model": self._model, "input": texts}, ensure_ascii=False).encode()
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
        payload: dict[str, Any] = resp.json()
        data = payload.get("data")
        if not isinstance(data, list) or not data:
            raise ValueError("OpenAI embeddings response missing data[]")
        ordered = sorted(data, key=lambda x: x.get("index", 0))
        return [_extract_vector(item) for item in ordered]


def _extract_vector(item: Any) -> list[float]:
    if not isinstance(item, dict):
        raise ValueError(f"unexpected embeddings item type: {type(item)}")
    emb = item.get("embedding")
    if not isinstance(emb, list):
        raise ValueError("missing embedding field")
    return [float(x) for x in emb]
