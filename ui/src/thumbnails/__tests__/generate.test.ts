// Copyright GraphCaster. All Rights Reserved.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockToPng = vi.fn();

vi.mock("html-to-image", () => ({
  toPng: mockToPng,
}));

describe("generateCanvasThumbnail", () => {
  beforeEach(() => {
    mockToPng.mockReset();
  });

  it("returns a PNG Blob when toPng succeeds", async () => {
    const pngDataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    mockToPng.mockResolvedValue(pngDataUrl);

    const { generateCanvasThumbnail } = await import("../generate");
    const el = document.createElement("div");
    const blob = await generateCanvasThumbnail(el);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("passes default width=256 and height=160 to toPng", async () => {
    const pngDataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    mockToPng.mockResolvedValue(pngDataUrl);

    const { generateCanvasThumbnail } = await import("../generate");
    const el = document.createElement("div");
    await generateCanvasThumbnail(el);

    expect(mockToPng).toHaveBeenCalledWith(
      el,
      expect.objectContaining({ width: 256, height: 160 }),
    );
  });

  it("passes custom width and height to toPng", async () => {
    const pngDataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    mockToPng.mockResolvedValue(pngDataUrl);

    const { generateCanvasThumbnail } = await import("../generate");
    const el = document.createElement("div");
    await generateCanvasThumbnail(el, { width: 128, height: 80 });

    expect(mockToPng).toHaveBeenCalledWith(
      el,
      expect.objectContaining({ width: 128, height: 80 }),
    );
  });

  it("lazy-imports html-to-image (dynamic import resolves without error)", async () => {
    const pngDataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    mockToPng.mockResolvedValue(pngDataUrl);

    const { generateCanvasThumbnail } = await import("../generate");
    const el = document.createElement("div");

    await expect(generateCanvasThumbnail(el)).resolves.toBeInstanceOf(Blob);
  });
});
