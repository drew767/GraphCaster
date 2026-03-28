// Copyright GraphCaster. All Rights Reserved.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { writeTextToClipboard } from "./clipboardWrite";

describe("writeTextToClipboard", () => {
  const writeText = vi.fn();

  beforeEach(() => {
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      ...globalThis.navigator,
      clipboard: { writeText },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns true and uses Clipboard API when writeText succeeds", async () => {
    const ok = await writeTextToClipboard("hello");
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("returns true when Clipboard API fails and execCommand copy succeeds", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    const ta = {
      value: "",
      style: {} as Record<string, string>,
      select: vi.fn(),
    };
    const appendChild = vi.fn();
    const removeChild = vi.fn();
    const execCommand = vi.fn().mockReturnValue(true);
    vi.stubGlobal(
      "document",
      {
        createElement: () => ta,
        body: { appendChild, removeChild },
        execCommand,
      } as unknown as Document,
    );
    const ok = await writeTextToClipboard("fallback");
    expect(ok).toBe(true);
    expect(ta.value).toBe("fallback");
    expect(appendChild).toHaveBeenCalledWith(ta);
    expect(removeChild).toHaveBeenCalledWith(ta);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("returns false when Clipboard API fails and execCommand returns false", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    const ta = {
      value: "",
      style: {} as Record<string, string>,
      select: vi.fn(),
    };
    vi.stubGlobal(
      "document",
      {
        createElement: () => ta,
        body: { appendChild: vi.fn(), removeChild: vi.fn() },
        execCommand: vi.fn().mockReturnValue(false),
      } as unknown as Document,
    );
    const ok = await writeTextToClipboard("x");
    expect(ok).toBe(false);
  });
});
