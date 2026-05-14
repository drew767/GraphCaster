// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi } from "vitest";

import { initEmbedHost } from "./host";

type Listener = (ev: MessageEvent) => void;

interface FakeWindow {
  parent: FakeWindow;
  postMessage: ReturnType<typeof vi.fn>;
  addEventListener: (type: string, listener: Listener) => void;
  removeEventListener: (type: string, listener: Listener) => void;
  dispatch: (data: unknown, origin?: string) => void;
}

function makeWindow(): { child: FakeWindow; parent: FakeWindow } {
  const listeners: Listener[] = [];
  const parent: FakeWindow = {
    parent: undefined as unknown as FakeWindow,
    postMessage: vi.fn(),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatch: () => undefined,
  };
  parent.parent = parent;
  const child: FakeWindow = {
    parent,
    postMessage: vi.fn(),
    addEventListener: (type, listener) => {
      if (type === "message") listeners.push(listener);
    },
    removeEventListener: (type, listener) => {
      if (type !== "message") return;
      const i = listeners.indexOf(listener);
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatch: (data, origin = "http://parent.example") => {
      const ev = { data, origin } as MessageEvent;
      for (const l of [...listeners]) l(ev);
    },
  };
  return { child, parent };
}

describe("initEmbedHost", () => {
  it("emits a 'ready' event to the parent on init", () => {
    const { child, parent } = makeWindow();
    initEmbedHost({ window: child as unknown as Window & typeof globalThis });
    expect(parent.postMessage).toHaveBeenCalledWith(
      { type: "ready" },
      "*",
    );
  });

  it("dispatches a navigate command to the navigate handler", () => {
    const { child } = makeWindow();
    const navigate = vi.fn();
    initEmbedHost({
      window: child as unknown as Window & typeof globalThis,
      handlers: { navigate },
    });
    child.dispatch({ type: "navigate", path: "/home/workflows" });
    expect(navigate).toHaveBeenCalledWith("/home/workflows");
  });

  it("dispatches open-workflow command via navigate fallback", () => {
    const { child } = makeWindow();
    const navigate = vi.fn();
    initEmbedHost({
      window: child as unknown as Window & typeof globalThis,
      handlers: { navigate },
    });
    child.dispatch({ type: "open-workflow", workflowId: "wf-1" });
    expect(navigate).toHaveBeenCalledWith("/workflow/wf-1");
  });

  it("ignores messages from a different origin when origin option set", () => {
    const { child } = makeWindow();
    const navigate = vi.fn();
    initEmbedHost({
      window: child as unknown as Window & typeof globalThis,
      origin: "https://allowed.example",
      handlers: { navigate },
    });
    child.dispatch({ type: "navigate", path: "/x" }, "https://attacker.example");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("ignores malformed messages", () => {
    const { child } = makeWindow();
    const navigate = vi.fn();
    initEmbedHost({
      window: child as unknown as Window & typeof globalThis,
      handlers: { navigate },
    });
    child.dispatch({ type: "bogus" });
    child.dispatch("not an object");
    child.dispatch(null);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("set-readonly dispatches to setReadOnly handler", () => {
    const { child } = makeWindow();
    const setReadOnly = vi.fn();
    initEmbedHost({
      window: child as unknown as Window & typeof globalThis,
      handlers: { setReadOnly },
    });
    child.dispatch({ type: "set-readonly", readOnly: true });
    expect(setReadOnly).toHaveBeenCalledWith(true);
  });

  it("dispose removes the message listener", () => {
    const { child } = makeWindow();
    const navigate = vi.fn();
    const handle = initEmbedHost({
      window: child as unknown as Window & typeof globalThis,
      handlers: { navigate },
    });
    handle.dispose();
    child.dispatch({ type: "navigate", path: "/x" });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("emit posts events to parent", () => {
    const { child, parent } = makeWindow();
    const handle = initEmbedHost({
      window: child as unknown as Window & typeof globalThis,
    });
    parent.postMessage.mockClear();
    handle.emit({ type: "workflow-saved", workflowId: "wf-9" });
    expect(parent.postMessage).toHaveBeenCalledWith(
      { type: "workflow-saved", workflowId: "wf-9" },
      "*",
    );
  });
});
