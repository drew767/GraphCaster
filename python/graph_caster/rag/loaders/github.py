# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import base64
import fnmatch
import os
from typing import AsyncIterator

from graph_caster.rag.loaders.base import Document, DocumentLoader

_GITHUB_API_BASE = "https://api.github.com"


def _require_httpx():
    try:
        import httpx  # noqa: F401
    except ImportError as exc:
        raise ImportError(
            "httpx is required for GitHubLoader. "
            'Install it with: pip install "graph-caster[rag-loaders-web]"'
        ) from exc


class GitHubLoader(DocumentLoader):
    """Load files from a GitHub repository via the REST API.

    One Document per file. Files are fetched recursively.

    Requires the optional ``rag-loaders-web`` extra::

        pip install "graph-caster[rag-loaders-web]"

    Parameters
    ----------
    repo:
        Repository in ``owner/name`` form (e.g. ``"openai/openai-python"``).
    branch:
        Branch or tag to read from (default: ``"main"``).
    path:
        Sub-path within the repository to limit the listing (default: root).
    token_env:
        Name of the environment variable holding the GitHub token
        (default: ``"GITHUB_TOKEN"``).
    file_glob:
        Optional glob pattern to filter files (e.g. ``"*.py"``).
    transport:
        Optional ``httpx.AsyncBaseTransport`` for testing.
    """

    def __init__(
        self,
        repo: str,
        *,
        branch: str = "main",
        path: str = "",
        token_env: str = "GITHUB_TOKEN",
        file_glob: str | None = None,
        transport=None,
    ) -> None:
        self._repo = repo
        self._branch = branch
        self._path = path.lstrip("/")
        self._token_env = token_env
        self._file_glob = file_glob
        self._transport = transport

    def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
        token = os.environ.get(self._token_env, "")
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return headers

    async def _list_files(self, client) -> list[dict]:
        url = f"{_GITHUB_API_BASE}/repos/{self._repo}/git/trees/{self._branch}?recursive=1"
        resp = await client.get(url, headers=self._headers())
        resp.raise_for_status()
        data = resp.json()
        tree = data.get("tree", [])
        files = [item for item in tree if item.get("type") == "blob"]
        if self._path:
            files = [f for f in files if f["path"].startswith(self._path)]
        if self._file_glob:
            files = [
                f for f in files if fnmatch.fnmatch(f["path"], self._file_glob)
            ]
        return files

    async def _fetch_content(self, client, file_path: str) -> str:
        url = f"{_GITHUB_API_BASE}/repos/{self._repo}/contents/{file_path}?ref={self._branch}"
        resp = await client.get(url, headers=self._headers())
        resp.raise_for_status()
        data = resp.json()
        encoding = data.get("encoding", "")
        raw = data.get("content", "")
        if encoding == "base64":
            return base64.b64decode(raw.replace("\n", "")).decode("utf-8", errors="replace")
        return raw

    async def load(self) -> list[Document]:
        return [doc async for doc in self.lazy_load()]

    async def lazy_load(self) -> AsyncIterator[Document]:
        _require_httpx()
        import httpx

        kwargs = {}
        if self._transport is not None:
            kwargs["transport"] = self._transport

        async with httpx.AsyncClient(**kwargs) as client:
            files = await self._list_files(client)
            for file_entry in files:
                file_path = file_entry["path"]
                try:
                    content = await self._fetch_content(client, file_path)
                except Exception:
                    continue
                yield Document(
                    page_content=content,
                    metadata={
                        "source": f"https://github.com/{self._repo}/blob/{self._branch}/{file_path}",
                        "repo": self._repo,
                        "branch": self._branch,
                        "file_path": file_path,
                    },
                )
