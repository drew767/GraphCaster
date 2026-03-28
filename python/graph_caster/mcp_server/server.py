# Copyright GraphCaster. All Rights Reserved.

"""FastMCP stdio server wiring. Requires optional dependency ``mcp`` (``pip install -e ".[mcp]"``).

**M1 (SDK choice):** используем официальный пакет **`mcp`** с **`FastMCP`** (Pydantic, stdio через **`anyio`**) — тот же класс подхода, что у экосистемы Langflow/Dify, без дублирования JSON-RPC протокола вручную. Альтернатива «тонкий самописный MCP» отклонена из‑за риска рассинхрона со спецификацией и объёма тестов.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from graph_caster.host_context import RunHostContext

from graph_caster.mcp_server.handlers import (
    cancel_run_handler,
    list_graphs_handler,
    run_graph_handler,
)


def build_fastmcp(host: RunHostContext):
    """Return a configured ``FastMCP`` instance (tools registered)."""
    from mcp.server.fastmcp import FastMCP

    mcp = FastMCP(
        "GraphCaster",
        instructions=(
            "GraphCaster MCP: list graphs in the configured workspace graphs/ directory and run graph JSON "
            "documents. Graph execution uses the same runner as the CLI; stdio is reserved for MCP — run events "
            "are not streamed as NDJSON here (use eventBriefs in tool results). "
            "Tool outputs are structured JSON objects (not double-encoded strings). "
            "On graphcaster_run_graph timeout: the server requests cooperative cancel on the same runId (between "
            "runner steps); a long-running subprocess inside a task node may keep running until it ends. "
            "Optional env GC_MCP_TOKEN: reserved for future authenticated transports; stdio mode does not validate it."
        ),
    )

    @mcp.tool(name="graphcaster_list_graphs")
    async def graphcaster_list_graphs(
        limit: int = 200,
        include_titles: bool = False,
    ) -> dict[str, Any]:
        import anyio

        def _call() -> dict[str, Any]:
            return list_graphs_handler(host, limit=limit, include_titles=include_titles)

        return await anyio.to_thread.run_sync(_call)

    @mcp.tool(name="graphcaster_run_graph")
    async def graphcaster_run_graph(
        graph_id: str | None = None,
        relative_path: str | None = None,
        timeout_sec: float = 600.0,
        dry_run_validate_only: bool = False,
    ) -> dict[str, Any]:
        import anyio

        def _call() -> dict[str, Any]:
            return run_graph_handler(
                host,
                graph_id=graph_id,
                relative_path=relative_path,
                timeout_sec=timeout_sec,
                dry_run_validate_only=dry_run_validate_only,
            )

        return await anyio.to_thread.run_sync(_call)

    @mcp.tool(name="graphcaster_cancel_run")
    async def graphcaster_cancel_run() -> dict[str, Any]:
        return cancel_run_handler()

    return mcp


def run_stdio(host: RunHostContext) -> None:
    """Run the MCP server on stdio (blocks until disconnect)."""
    app = build_fastmcp(host)
    app.run(transport="stdio")


def host_from_cli(
    graphs_dir: Path,
    workspace_root: Path | None,
    artifacts_base: Path | None,
) -> RunHostContext:
    gr = graphs_dir.resolve()
    wr = Path(workspace_root).resolve() if workspace_root is not None else None
    ab = Path(artifacts_base).resolve() if artifacts_base is not None else None
    return RunHostContext(graphs_root=gr, workspace_root=wr, artifacts_base=ab)
