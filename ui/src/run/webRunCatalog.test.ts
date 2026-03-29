// Copyright GraphCaster. All Rights Reserved.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchRunCatalogList,
  fetchRunCatalogRebuild,
  parseRunCatalogListJson,
} from "./webRunBroker";

describe("parseRunCatalogListJson", () => {
  it("returns empty for non-object or missing items", () => {
    expect(parseRunCatalogListJson(null)).toEqual([]);
    expect(parseRunCatalogListJson({})).toEqual([]);
    expect(parseRunCatalogListJson({ items: null })).toEqual([]);
  });

  it("maps valid broker rows", () => {
    const rows = parseRunCatalogListJson({
      items: [
        {
          runId: "r1",
          rootGraphId: "g-main",
          runDirName: "2024",
          status: "success",
          startedAt: "t0",
          finishedAt: "t1",
          artifactRelPath: "runs/g-main/2024",
        },
        {
          runId: "",
          rootGraphId: "x",
          runDirName: "y",
          status: "ok",
          finishedAt: "t",
          artifactRelPath: "",
        },
        {
          runId: "r2",
          rootGraphId: "g2",
          run_dir_name: "dir-b",
          status: "failed",
          startedAt: null,
          finishedAt: "tf",
          artifactRelPath: "p",
        },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      runId: "r1",
      rootGraphId: "g-main",
      runDirName: "2024",
      status: "success",
      startedAt: "t0",
      finishedAt: "t1",
      artifactRelPath: "runs/g-main/2024",
    });
    expect(rows[1].runId).toBe("r2");
    expect(rows[1].runDirName).toBe("dir-b");
    expect(rows[1].startedAt).toBeNull();
  });
});

describe("fetchRunCatalogList / fetchRunCatalogRebuild", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetchRunCatalogList posts JSON and maps response", async () => {
    const sample = {
      items: [
        {
          runId: "a",
          rootGraphId: "g",
          runDirName: "d",
          status: "success",
          startedAt: null,
          finishedAt: "f",
          artifactRelPath: "runs/g/d",
        },
      ],
    };
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => sample,
      text: async () => "",
    } as Response);

    const rows = await fetchRunCatalogList("/workspace", { graphId: "my-graph", limit: 10, offset: 2 });
    expect(fetch).toHaveBeenCalledTimes(1);
    const call = vi.mocked(fetch).mock.calls[0];
    const url = String(call[0]);
    const init = call[1] as RequestInit;
    expect(url.endsWith("/run-catalog/list")).toBe(true);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.artifactsBase).toBe("/workspace");
    expect(body.graphId).toBe("my-graph");
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(2);
    expect(rows).toEqual(sample.items);
  });

  it("fetchRunCatalogRebuild returns decimal string from rebuilt number", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ rebuilt: 42 }),
      text: async () => "",
    } as Response);
    await expect(fetchRunCatalogRebuild("/root")).resolves.toBe("42");
    const call = vi.mocked(fetch).mock.calls[0];
    const init = call[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ artifactsBase: "/root" });
  });

  it("fetchRunCatalogRebuild accepts rebuilt as string", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ rebuilt: "9007199254740993" }),
      text: async () => "",
    } as Response);
    await expect(fetchRunCatalogRebuild("/root")).resolves.toBe("9007199254740993");
  });
});
