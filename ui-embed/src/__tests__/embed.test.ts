// Copyright GraphCaster. All Rights Reserved.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbedConfig } from "../index";

// We import the module pieces directly (not the IIFE bundle) so vitest can
// work in jsdom without needing the full Vite build pipeline.
import { mountBubble } from "../bubble";
import { createChatPanel } from "../chat";

// Helpers
function cfg(overrides: Partial<EmbedConfig> = {}): EmbedConfig {
  return {
    graphId: "test-graph-id",
    apiBase: "https://example.com/api/v1",
    theme: "light",
    position: "bottom-right",
    welcomeMessage: "Hello from tests",
    ...overrides,
  };
}

describe("mountBubble", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders bubble button in document.body", () => {
    mountBubble(cfg());
    const btn = document.body.querySelector(".gc-embed-bubble");
    expect(btn).not.toBeNull();
  });

  it("renders chat panel hidden initially", () => {
    mountBubble(cfg());
    const panel = document.body.querySelector(".gc-embed-panel");
    expect(panel).not.toBeNull();
    expect(panel?.classList.contains("gc-embed-panel--hidden")).toBe(true);
  });

  it("click bubble opens panel", () => {
    mountBubble(cfg());
    const btn = document.body.querySelector<HTMLButtonElement>(".gc-embed-bubble")!;
    btn.click();
    const panel = document.body.querySelector(".gc-embed-panel");
    expect(panel?.classList.contains("gc-embed-panel--hidden")).toBe(false);
  });

  it("click bubble again closes panel", () => {
    mountBubble(cfg());
    const btn = document.body.querySelector<HTMLButtonElement>(".gc-embed-bubble")!;
    btn.click();
    btn.click();
    const panel = document.body.querySelector(".gc-embed-panel");
    expect(panel?.classList.contains("gc-embed-panel--hidden")).toBe(true);
  });

  it("positions bubble with bottom-left class", () => {
    mountBubble(cfg({ position: "bottom-left" }));
    const btn = document.body.querySelector(".gc-embed-bubble");
    expect(btn?.classList.contains("gc-embed-bubble--bottom-left")).toBe(true);
  });

  it("applies dark theme class to panel", () => {
    mountBubble(cfg({ theme: "dark" }));
    const panel = document.body.querySelector(".gc-embed-panel");
    expect(panel?.classList.contains("gc-embed-panel--dark")).toBe(true);
  });

  it("shows welcome message in panel", () => {
    mountBubble(cfg({ welcomeMessage: "Hi there!" }));
    const welcome = document.body.querySelector(".gc-embed-welcome");
    expect(welcome?.textContent).toBe("Hi there!");
  });
});

describe("createChatPanel — send message", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs to apiBase/openai/chat/completions with correct body", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
        "data: [DONE]\n",
      ]),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { panel, open } = createChatPanel(cfg());
    document.body.appendChild(panel);
    open();

    const textarea = panel.querySelector<HTMLTextAreaElement>(".gc-embed-input")!;
    const sendBtn = panel.querySelector<HTMLButtonElement>(".gc-embed-send-btn")!;

    textarea.value = "Hello world";
    sendBtn.click();

    // Wait for async fetch + stream
    await flushPromises();

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.com/api/v1/openai/chat/completions");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body as string) as {
      model: string;
      stream: boolean;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe("gc-graph:test-graph-id");
    expect(body.stream).toBe(true);
    expect(body.messages.at(-1)?.content).toBe("Hello world");
  });

  it("uses public link endpoint when shareLinkId is set", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream(["data: [DONE]\n"]),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { panel, open } = createChatPanel(
      cfg({ shareLinkId: "link-abc" }),
    );
    document.body.appendChild(panel);
    open();

    const textarea = panel.querySelector<HTMLTextAreaElement>(".gc-embed-input")!;
    const sendBtn = panel.querySelector<HTMLButtonElement>(".gc-embed-send-btn")!;
    textarea.value = "test";
    sendBtn.click();

    await flushPromises();

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.com/api/v1/public/link-abc/run");
  });

  it("appends stream chunks to last assistant message", async () => {
    const chunks = ["Hel", "lo ", "world"];
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream([
        ...chunks.map((c) => `data: {"choices":[{"delta":{"content":"${c}"}}]}\n`),
        "data: [DONE]\n",
      ]),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { panel, open } = createChatPanel(cfg());
    document.body.appendChild(panel);
    open();

    const textarea = panel.querySelector<HTMLTextAreaElement>(".gc-embed-input")!;
    const sendBtn = panel.querySelector<HTMLButtonElement>(".gc-embed-send-btn")!;
    textarea.value = "Hi";
    sendBtn.click();

    await flushPromises();

    const bubbles = panel.querySelectorAll(".gc-embed-msg--assistant .gc-embed-msg__bubble");
    const last = bubbles[bubbles.length - 1];
    expect(last?.textContent).toBe("Hello world");
  });

  it("removes streaming class after done", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream([
        'data: {"choices":[{"delta":{"content":"Hi"}}]}\n',
        "data: [DONE]\n",
      ]),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { panel, open } = createChatPanel(cfg());
    document.body.appendChild(panel);
    open();

    const textarea = panel.querySelector<HTMLTextAreaElement>(".gc-embed-input")!;
    textarea.value = "test";
    panel.querySelector<HTMLButtonElement>(".gc-embed-send-btn")!.click();

    await flushPromises();

    const streamingRows = panel.querySelectorAll(".gc-embed-msg--streaming");
    expect(streamingRows.length).toBe(0);
  });
});

// ---- Helpers ----

function makeSSEStream(lines: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < lines.length) {
        controller.enqueue(enc.encode(lines[i++]));
      } else {
        controller.close();
      }
    },
  });
}

async function flushPromises(): Promise<void> {
  // Drain micro + macro task queues across a few ticks
  for (let t = 0; t < 20; t++) {
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}
