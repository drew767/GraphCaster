// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  listTemplates,
  getTemplate,
  __clearTemplateCache,
  type TemplateMeta,
} from "../templates";
import { LOCAL_TEMPLATES } from "../templates.local";

beforeEach(() => {
  __clearTemplateCache();
});

describe("templates API client", () => {
  it("returns local sample data when no remote URL is set", async () => {
    const result = await listTemplates();
    expect(result.length).toBe(LOCAL_TEMPLATES.length);
    expect(result[0]).toHaveProperty("id");
    expect(result[0]).toHaveProperty("name");
    expect(result[0]).toHaveProperty("categories");
  });

  it("filters by search query against name/description/tags/categories", async () => {
    const result = await listTemplates({ search: "newsletter" });
    expect(result.length).toBeGreaterThan(0);
    for (const t of result) {
      const hay = [t.name, t.description, ...(t.tags ?? []), ...t.categories]
        .join(" ")
        .toLowerCase();
      expect(hay).toContain("newsletter");
    }
  });

  it("returns no results when search matches nothing", async () => {
    const result = await listTemplates({ search: "zzzz-no-match-zzzz" });
    expect(result.length).toBe(0);
  });

  it("filters by single category", async () => {
    const result = await listTemplates({ categories: ["DevOps"] });
    expect(result.length).toBeGreaterThan(0);
    for (const t of result) {
      expect(t.categories).toContain("DevOps");
    }
  });

  it("filters by multiple categories (OR semantics)", async () => {
    const result = await listTemplates({ categories: ["DevOps", "Marketing"] });
    for (const t of result) {
      expect(
        t.categories.includes("DevOps") || t.categories.includes("Marketing"),
      ).toBe(true);
    }
  });

  it("sorts by views descending", async () => {
    const result = await listTemplates({ sort: "views" });
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].views).toBeGreaterThanOrEqual(result[i].views);
    }
  });

  it("sorts by createdAt descending (newest first)", async () => {
    const result = await listTemplates({ sort: "created" });
    for (let i = 1; i < result.length; i++) {
      expect(
        result[i - 1].createdAt.localeCompare(result[i].createdAt),
      ).toBeGreaterThanOrEqual(0);
    }
  });

  it("getTemplate returns matching template", async () => {
    const result = await getTemplate(LOCAL_TEMPLATES[0].id);
    expect(result).not.toBeNull();
    expect(result?.id).toBe(LOCAL_TEMPLATES[0].id);
  });

  it("getTemplate returns null for unknown id", async () => {
    const result = await getTemplate("no-such-template");
    expect(result).toBeNull();
  });

  it("uses provided fetchFn when remoteUrl is set", async () => {
    const remoteData: TemplateMeta[] = [
      {
        id: "remote-1",
        name: "Remote one",
        description: "Remote-only",
        author: { name: "Remote" },
        categories: ["Remote"],
        nodes: ["http.request"],
        workflow: {},
        createdAt: "2026-04-01T00:00:00Z",
        views: 1,
      },
    ];
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(remoteData), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const result = await listTemplates(undefined, {
      remoteUrl: "https://example.com/api/templates",
      fetchFn,
    });
    expect(result.length).toBe(1);
    expect(result[0].id).toBe("remote-1");
  });

  it("falls back to local data when remote fetch fails", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("network")) as unknown as typeof fetch;
    const result = await listTemplates(undefined, {
      remoteUrl: "https://example.com/api/templates",
      fetchFn,
    });
    expect(result.length).toBe(LOCAL_TEMPLATES.length);
  });

  it("caches responses within TTL window", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;
    let nowVal = 1_000_000;
    const deps = {
      remoteUrl: "https://example.com/api/templates",
      fetchFn,
      now: () => nowVal,
    };
    await listTemplates(undefined, deps);
    await listTemplates(undefined, deps);
    nowVal += 60_000; // still within 5 min TTL
    await listTemplates(undefined, deps);
    expect((fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
    nowVal += 5 * 60 * 1000 + 1; // past TTL
    await listTemplates(undefined, deps);
    expect((fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(2);
  });
});
