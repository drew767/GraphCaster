# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
from typing import Any

from graph_caster.rag.embeddings.base import Embedder

_MODEL_DIMS: dict[str, int] = {
    "amazon.titan-embed-text-v1": 1536,
    "amazon.titan-embed-text-v2:0": 1024,
    "cohere.embed-english-v3": 1024,
    "cohere.embed-multilingual-v3": 1024,
}


class BedrockEmbedder(Embedder):
    name = "bedrock"
    dim = 1536

    def __init__(
        self,
        model: str = "amazon.titan-embed-text-v1",
        region_name: str | None = None,
        boto3_client: Any = None,
    ) -> None:
        self._model = model
        self._region_name = region_name
        self._boto3_client = boto3_client
        self.dim = _MODEL_DIMS.get(model, 1536)

    def _get_client(self) -> Any:
        if self._boto3_client is not None:
            return self._boto3_client
        try:
            import boto3
        except ImportError as exc:
            raise ImportError(
                "BedrockEmbedder requires boto3 (pip install 'graph-caster[rag-embed-bedrock]')"
            ) from exc
        kwargs: dict[str, Any] = {"service_name": "bedrock-runtime"}
        if self._region_name:
            kwargs["region_name"] = self._region_name
        return boto3.client(**kwargs)

    def _embed_titan(self, client: Any, text: str) -> list[float]:
        body = json.dumps({"inputText": text})
        resp = client.invoke_model(
            modelId=self._model,
            body=body,
            contentType="application/json",
            accept="application/json",
        )
        payload = json.loads(resp["body"].read())
        emb = payload.get("embedding")
        if not isinstance(emb, list):
            raise ValueError(f"BedrockEmbedder: unexpected titan response: {list(payload.keys())}")
        return [float(x) for x in emb]

    def _embed_cohere(self, client: Any, texts: list[str]) -> list[list[float]]:
        body = json.dumps({"texts": texts, "input_type": "search_document"})
        resp = client.invoke_model(
            modelId=self._model,
            body=body,
            contentType="application/json",
            accept="application/json",
        )
        payload = json.loads(resp["body"].read())
        embeddings = payload.get("embeddings")
        if not isinstance(embeddings, list):
            raise ValueError(f"BedrockEmbedder: unexpected cohere response: {list(payload.keys())}")
        return [[float(x) for x in vec] for vec in embeddings]

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        client = self._get_client()
        if self._model.startswith("cohere."):
            return self._embed_cohere(client, texts)
        return [self._embed_titan(client, t) for t in texts]
