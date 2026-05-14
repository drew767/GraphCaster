# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import os
from typing import Any

import httpx

from graph_caster.rag.embeddings.base import ConfigError, Embedder

_MODEL_DIMS: dict[str, int] = {
    "embed-english-v3.0": 1024,
    "embed-multilingual-v3.0": 1024,
    "embed-english-light-v3.0": 384,
    "embed-multilingual-light-v3.0": 384,
}


class CohereEmbedder(Embedder):
    name = "cohere"
    dim = 1024

    def __init__(
        self,
        model: str = "embed-english-v3.0",
        api_key: str | None = None,
        input_type: str = "search_document",
        timeout: float = 120.0,
    ) -> None:
        self._model = model
        self._api_key = api_key
        self._input_type = input_type
        self._timeout = timeout
        self.dim = _MODEL_DIMS.get(model, 1024)

    def _resolve_key(self) -> str:
        key = (self._api_key or os.environ.get("COHERE_API_KEY") or "").strip()
        if not key:
            raise ConfigError("CohereEmbedder requires COHERE_API_KEY")
        return key

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        key = self._resolve_key()
        body = json.dumps(
            {
                "model": self._model,
                "texts": texts,
                "input_type": self._input_type,
                "embedding_types": ["float"],
            },
            ensure_ascii=False,
        ).encode()
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(
                "https://api.cohere.com/v1/embed",
                content=body,
                headers={
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                    "X-Client-Name": "graph-caster",
                },
            )
        resp.raise_for_status()
        payload: dict[str, Any] = resp.json()
        embeddings = payload.get("embeddings")
        if isinstance(embeddings, dict):
            vecs = embeddings.get("float")
        elif isinstance(embeddings, list):
            vecs = embeddings
        else:
            vecs = None
        if not isinstance(vecs, list) or not vecs:
            raise ValueError(f"CohereEmbedder: unexpected response shape: {list(payload.keys())}")
        return [[float(x) for x in vec] for vec in vecs]
