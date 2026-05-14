# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from typing import TYPE_CHECKING, AsyncIterator

from graph_caster.rag.loaders.base import Document, DocumentLoader

if TYPE_CHECKING:
    pass


def _require_deps():
    try:
        import httpx  # noqa: F401
    except ImportError as exc:
        raise ImportError(
            "httpx is required for WebLoader. "
            'Install it with: pip install "graph-caster[rag-loaders-web]"'
        ) from exc
    try:
        from bs4 import BeautifulSoup  # noqa: F401
    except ImportError as exc:
        raise ImportError(
            "beautifulsoup4 is required for WebLoader. "
            'Install it with: pip install "graph-caster[rag-loaders-web]"'
        ) from exc


class WebLoader(DocumentLoader):
    """Fetch a URL with httpx and extract text via BeautifulSoup.

    Requires the optional ``rag-loaders-web`` extra::

        pip install "graph-caster[rag-loaders-web]"

    Parameters
    ----------
    url:
        The URL to fetch.
    css_selector:
        Optional CSS selector to limit extraction to a subtree.
    transport:
        Optional ``httpx.AsyncBaseTransport`` for testing (e.g. ``httpx.MockTransport``).
    """

    def __init__(
        self,
        url: str,
        *,
        css_selector: str | None = None,
        transport=None,
    ) -> None:
        self._url = url
        self._css_selector = css_selector
        self._transport = transport

    async def load(self) -> list[Document]:
        return [doc async for doc in self.lazy_load()]

    async def lazy_load(self) -> AsyncIterator[Document]:
        _require_deps()
        import httpx
        from bs4 import BeautifulSoup

        kwargs = {}
        if self._transport is not None:
            kwargs["transport"] = self._transport

        async with httpx.AsyncClient(**kwargs) as client:
            response = await client.get(self._url)
            response.raise_for_status()
            html = response.text

        soup = BeautifulSoup(html, "html.parser")
        title_tag = soup.find("title")
        title = title_tag.get_text(strip=True) if title_tag else ""

        if self._css_selector:
            container = soup.select_one(self._css_selector)
            text = container.get_text(separator="\n", strip=True) if container else ""
        else:
            for tag in soup(["script", "style"]):
                tag.decompose()
            text = soup.get_text(separator="\n", strip=True)

        yield Document(
            page_content=text,
            metadata={"source": self._url, "title": title},
        )
