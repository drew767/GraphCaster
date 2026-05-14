// Copyright GraphCaster. All Rights Reserved.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  dispatchMenuEvent,
  startMenuBridge,
  type MenuEventPayload,
} from "./menuBridge";

describe("dispatchMenuEvent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("invokes the matching handler", () => {
    const fileNew = vi.fn();
    const fileSave = vi.fn();
    dispatchMenuEvent({ id: "file.save" }, { "file.new": fileNew, "file.save": fileSave });
    expect(fileSave).toHaveBeenCalledTimes(1);
    expect(fileNew).not.toHaveBeenCalled();
  });

  it("warns when no handler is registered for the id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    dispatchMenuEvent({ id: "view.unknown" }, {});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("view.unknown");
  });

  it("ignores empty / malformed payloads", () => {
    const handler = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    dispatchMenuEvent(null, { "file.new": handler });
    dispatchMenuEvent(undefined, { "file.new": handler });
    dispatchMenuEvent({ id: "" }, { "file.new": handler });
    expect(handler).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("swallows handler errors without crashing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const boom = vi.fn(() => {
      throw new Error("boom");
    });
    dispatchMenuEvent({ id: "edit.undo" }, { "edit.undo": boom });
    expect(boom).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });
});

describe("startMenuBridge", () => {
  it("registers a listener on the menu event and dispatches payloads to handlers", async () => {
    const fileSave = vi.fn();
    const helpAbout = vi.fn();
    type Listener = (event: { payload: MenuEventPayload }) => void;
    let stored: Listener | null = null;
    const unlisten = vi.fn();
    const fakeListen = vi.fn(async (event: string, cb: Listener) => {
      expect(event).toBe("menu");
      stored = cb;
      return unlisten;
    });

    const unsub = await startMenuBridge(
      { "file.save": fileSave, "help.about": helpAbout },
      fakeListen as unknown as Parameters<typeof startMenuBridge>[1],
    );

    expect(fakeListen).toHaveBeenCalledTimes(1);
    expect(stored).not.toBeNull();

    stored!({ payload: { id: "file.save" } });
    stored!({ payload: { id: "help.about" } });

    expect(fileSave).toHaveBeenCalledTimes(1);
    expect(helpAbout).toHaveBeenCalledTimes(1);

    unsub();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("reads handlers lazily so late-registered entries still dispatch", async () => {
    const handlers: Record<string, () => void> = {};
    const late = vi.fn();
    type Listener = (event: { payload: MenuEventPayload }) => void;
    let stored: Listener | null = null;
    const fakeListen = vi.fn(async (_event: string, cb: Listener) => {
      stored = cb;
      return () => {};
    });

    await startMenuBridge(
      handlers,
      fakeListen as unknown as Parameters<typeof startMenuBridge>[1],
    );

    handlers["edit.find"] = late;
    stored!({ payload: { id: "edit.find" } });

    expect(late).toHaveBeenCalledTimes(1);
  });
});
