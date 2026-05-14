# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import os
from typing import Any

import httpx

from graph_caster.rag.embeddings.base import ConfigError, Embedder

_MODEL_DIMS: dict[str, int] = {
    "jina-embeddings-v2-base-en": 768,
    "jina-embeddings-v2-small-en": 512,
    "jina-embeddings-v2-base-de": 768,
    "jina-embeddings-v2-base-zh": 768,
    "jina-embeddings-v3": 1024,
}


class JinaEmbedder(Embedder):
    name = "jina"
    dim = 768

    def __init__(
        self,
        model: str = "jina-embeddings-v2-base-en",
        api_key: str | None = None,
        timeout: float = 120.0,
    ) -> None:
        self._model = model
        self._api_key = api_key
        self._timeout = timeout
        self.dim = _MODEL_DIMS.get(model, 768)

    def _resolve_key(self) -> str:
        key = (self._api_key or os.environ.get("JINA_API_KEY") or "").strip()
        if not key:
            raise ConfigError("JinaEmbedder requires JINA_API_KEY")
        return key

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        key = self._resolve_key()
        body = json.dumps(
            {"model": self._model, "input": texts},
            ensure_ascii=False,
        ).encode()
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(
                "https://api.jina.ai/v1/embeddings",
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
            raise ValueError("JinaEmbedder: missing data[] in response")
        ordered = sorted(data, key=lambda x: x.get("index", 0))
        return [[float(x) for x in item["embedding"]] for item in ordered]
