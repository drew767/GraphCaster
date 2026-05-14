# Copyright GraphCaster. All Rights Reserved.

"""Built-in tool: Wikipedia search via MediaWiki OpenSearch API."""

from __future__ import annotations

from typing import Any


async def wikipedia_search(
    query: str,
    *,
    lang: str = "en",
    limit: int = 3,
    _transport: Any = None,
) -> list[dict]:
    """Search Wikipedia and return up to *limit* results.

    Each result has keys: title, url, summary.
    Uses the MediaWiki opensearch action — no API key required.
    """
    import httpx

    url = f"https://{lang}.wikipedia.org/w/api.php"
    params = {
        "action": "opensearch",
        "search": query,
        "limit": str(min(max(1, int(limit)), 20)),
        "namespace": "0",
        "format": "json",
    }
    kwargs: dict = {
        "timeout": 15.0,
        "follow_redirects": True,
    }
    if _transport is not None:
        kwargs["transport"] = _transport

    async with httpx.AsyncClient(**kwargs) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()

    titles: list[str] = data[1] if len(data) > 1 else []
    summaries: list[str] = data[2] if len(data) > 2 else []
    page_urls: list[str] = data[3] if len(data) > 3 else []

    max_n = min(max(1, int(limit)), 20)
    results: list[dict] = []
    for i, title in enumerate(titles[:max_n]):
        results.append(
            {
                "title": title,
                "url": page_urls[i] if i < len(page_urls) else "",
                "summary": summaries[i] if i < len(summaries) else "",
            }
        )
    return results
