# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import os
from typing import Any

import httpx

from graph_caster.rag.embeddings.base import ConfigError, Embedder

_MODEL_DIMS: dict[str, int] = {
    "voyage-2": 1024,
    "voyage-large-2": 1536,
    "voyage-code-2": 1536,
    "voyage-lite-02-instruct": 1024,
}


class VoyageEmbedder(Embedder):
    name = "voyage"
    dim = 1024

    def __init__(
        self,
        model: str = "voyage-2",
        api_key: str | None = None,
        input_type: str | None = None,
        timeout: float = 120.0,
    ) -> None:
        self._model = model
        self._api_key = api_key
        self._input_type = input_type
        self._timeout = timeout
        self.dim = _MODEL_DIMS.get(model, 1024)

    def _resolve_key(self) -> str:
        key = (self._api_key or os.environ.get("VOYAGE_API_KEY") or "").strip()
        if not key:
            raise ConfigError("VoyageEmbedder requires VOYAGE_API_KEY")
        return key

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        key = self._resolve_key()
        body_dict: dict[str, Any] = {"model": self._model, "input": texts}
        if self._input_type:
            body_dict["input_type"] = self._input_type
        body = json.dumps(body_dict, ensure_ascii=False).encode()
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(
                "https://api.voyageai.com/v1/embeddings",
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
            raise ValueError("VoyageEmbedder: missing data[] in response")
        ordered = sorted(data, key=lambda x: x.get("index", 0))
        return [[float(x) for x in item["embedding"]] for item in ordered]
