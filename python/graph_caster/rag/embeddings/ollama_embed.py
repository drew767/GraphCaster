# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import os
from typing import Any

import httpx

from graph_caster.rag.embeddings.base import Embedder

_MODEL_DIMS: dict[str, int] = {
    "nomic-embed-text": 768,
    "mxbai-embed-large": 1024,
    "all-minilm": 384,
}


class OllamaEmbedder(Embedder):
    name = "ollama"
    dim = 768

    def __init__(
        self,
        model: str = "nomic-embed-text",
        base_url: str | None = None,
        timeout: float = 120.0,
    ) -> None:
        self._model = model
        self._base_url = (
            base_url
            or os.environ.get("GC_OLLAMA_BASE_URL")
            or os.environ.get("OLLAMA_HOST")
            or "http://localhost:11434"
        ).rstrip("/")
        self._timeout = timeout
        self.dim = _MODEL_DIMS.get(model, 768)

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        results: list[list[float]] = []
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            for text in texts:
                body = json.dumps({"model": self._model, "prompt": text}, ensure_ascii=False).encode()
                resp = await client.post(
                    f"{self._base_url}/api/embeddings",
                    content=body,
                    headers={"Content-Type": "application/json"},
                )
                resp.raise_for_status()
                payload: dict[str, Any] = resp.json()
                emb = payload.get("embedding")
                if not isinstance(emb, list):
                    raise ValueError(f"OllamaEmbedder: missing embedding in response for model={self._model!r}")
                results.append([float(x) for x in emb])
        return results
