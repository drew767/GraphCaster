# Copyright GraphCaster. All Rights Reserved.

"""Built-in tool: DuckDuckGo web search."""

from __future__ import annotations

import json
from typing import Any
from urllib.parse import quote_plus


async def web_search(
    query: str,
    *,
    max_results: int = 5,
    region: str = "us-en",
    _transport: Any = None,
) -> list[dict]:
    """Search the web via DuckDuckGo and return up to *max_results* results.

    Each result has keys: title, url, snippet.
    Uses the DuckDuckGo Instant Answer API with HTML fallback.
    No API key required.
    """
    import httpx

    max_results = min(max(1, int(max_results)), 25)
    kwargs: dict = {
        "timeout": 15.0,
        "follow_redirects": True,
        "headers": {
            "User-Agent": "Mozilla/5.0 (compatible; GraphCaster/1.0)",
            "Accept": "application/json, text/html;q=0.9",
        },
    }
    if _transport is not None:
        kwargs["transport"] = _transport

    async with httpx.AsyncClient(**kwargs) as client:
        results = await _search_via_instant_api(client, query, region, max_results)
        if not results:
            results = await _search_via_html(client, query, region, max_results)

    return results[:max_results]


async def _search_via_instant_api(
    client: Any, query: str, region: str, max_results: int
) -> list[dict]:
    """DuckDuckGo Instant Answer JSON API (best-effort)."""
    try:
        resp = await client.get(
            "https://api.duckduckgo.com/",
            params={
                "q": query,
                "format": "json",
                "no_html": "1",
                "skip_disambig": "1",
                "kl": region,
            },
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return []

    results: list[dict] = []
    abstract_url = data.get("AbstractURL", "")
    abstract_text = data.get("AbstractText", "")
    if abstract_url and abstract_text:
        results.append(
            {
                "title": data.get("Heading", query),
                "url": abstract_url,
                "snippet": abstract_text[:500],
            }
        )

    for item in data.get("RelatedTopics", []):
        if len(results) >= max_results:
            break
        if not isinstance(item, dict):
            continue
        first_url = item.get("FirstURL", "")
        text = item.get("Text", "")
        if first_url and text:
            title = text.split(" - ")[0] if " - " in text else text[:80]
            results.append(
                {
                    "title": title,
                    "url": first_url,
                    "snippet": text[:500],
                }
            )

    return results


async def _search_via_html(
    client: Any, query: str, region: str, max_results: int
) -> list[dict]:
    """Fallback: parse DuckDuckGo HTML search results."""
    import re

    try:
        resp = await client.get(
            "https://html.duckduckgo.com/html/",
            params={"q": query, "kl": region},
        )
        resp.raise_for_status()
        html = resp.text
    except Exception:
        return []

    results: list[dict] = []
    pattern = re.compile(
        r'class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>.*?'
        r'class="result__snippet"[^>]*>(.*?)</span>',
        re.DOTALL,
    )
    for m in pattern.finditer(html):
        if len(results) >= max_results:
            break
        url = m.group(1).strip()
        title = re.sub(r"<[^>]+>", "", m.group(2)).strip()
        snippet = re.sub(r"<[^>]+>", "", m.group(3)).strip()
        if url and title:
            results.append({"title": title, "url": url, "snippet": snippet})

    return results
