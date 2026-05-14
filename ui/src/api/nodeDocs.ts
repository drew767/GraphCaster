// Copyright GraphCaster. All Rights Reserved.

export type NodeDocsResponse = {
  markdown: string | null;
};

export type FetchNodeDocsOptions = {
  fetcher?: typeof fetch;
  signal?: AbortSignal;
};

/** Fetch the markdown docs for a node type from the backend (`/api/v1/nodes/{type}/docs`). */
export async function fetchNodeDocs(
  nodeType: string,
  options?: FetchNodeDocsOptions,
): Promise<NodeDocsResponse> {
  if (typeof nodeType !== "string" || nodeType.trim() === "") {
    return { markdown: null };
  }
  const fetcher: typeof fetch =
    options?.fetcher ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null as unknown as typeof fetch);
  if (fetcher == null) {
    return { markdown: null };
  }
  try {
    const resp = await fetcher(`/api/v1/nodes/${encodeURIComponent(nodeType)}/docs`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: options?.signal,
    });
    if (!resp.ok) {
      return { markdown: null };
    }
    const ct = resp.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const body = (await resp.json()) as { markdown?: unknown };
      const md = body?.markdown;
      return { markdown: typeof md === "string" ? md : null };
    }
    const text = await resp.text();
    return { markdown: typeof text === "string" && text.length > 0 ? text : null };
  } catch {
    return { markdown: null };
  }
}
