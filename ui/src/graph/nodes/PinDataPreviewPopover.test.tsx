// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import {
  PinDataPreviewPopover,
  truncatePreviewText,
} from "./PinDataPreviewPopover";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const fallbacks: Record<string, string> = {
        "app.canvas.pin.preview.title": "Pinned data",
        "app.canvas.pin.preview.unpin": "Unpin",
      };
      return fallbacks[key] ?? key;
    },
  }),
}));

describe("truncatePreviewText", () => {
  it("returns input unchanged when under the limit", () => {
    expect(truncatePreviewText("a\nb\nc", 10)).toEqual({ text: "a\nb\nc", truncated: false });
  });
  it("trims to maxLines and appends an ellipsis line", () => {
    const input = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`).join("\n");
    const out = truncatePreviewText(input, 10);
    expect(out.truncated).toBe(true);
    const lines = out.text.split("\n");
    expect(lines.length).toBe(11);
    expect(lines[10]).toBe("...");
    expect(lines[9]).toBe("line 10");
  });
});

describe("PinDataPreviewPopover", () => {
  it("renders the title and a JSON preview of the pinned data", () => {
    render(
      <PinDataPreviewPopover
        pinData={{ hello: "world", count: 2 }}
        onUnpin={() => {}}
      />,
    );
    expect(screen.getByText("Pinned data")).toBeInTheDocument();
    // The pre block contains formatted JSON; both keys appear in its text.
    const pre = screen.getByText(/"hello"/);
    expect(pre.textContent).toContain("\"hello\": \"world\"");
    expect(pre.textContent).toContain("\"count\": 2");
  });

  it("truncates large pinned data to 10 lines plus ellipsis", () => {
    const big: Record<string, number> = {};
    for (let i = 0; i < 30; i += 1) {
      big[`key${i}`] = i;
    }
    render(<PinDataPreviewPopover pinData={big} onUnpin={() => {}} />);
    const pre = screen.getByText(/key0/).closest("pre");
    expect(pre).not.toBeNull();
    expect(pre!.dataset.truncated).toBe("true");
    const lines = pre!.textContent!.split("\n");
    expect(lines.length).toBe(11);
    expect(lines[10]).toBe("...");
  });

  it("calls onUnpin when the Unpin button is clicked", () => {
    const onUnpin = vi.fn();
    render(<PinDataPreviewPopover pinData={{ a: 1 }} onUnpin={onUnpin} />);
    fireEvent.click(screen.getByText("Unpin"));
    expect(onUnpin).toHaveBeenCalledTimes(1);
  });

  it("emits onHoverChange when the pointer enters or leaves the popover", () => {
    const onHoverChange = vi.fn();
    render(
      <PinDataPreviewPopover
        pinData={{ a: 1 }}
        onUnpin={() => {}}
        onHoverChange={onHoverChange}
      />,
    );
    const popover = screen.getByRole("tooltip");
    fireEvent.mouseEnter(popover);
    expect(onHoverChange).toHaveBeenLastCalledWith(true);
    fireEvent.mouseLeave(popover);
    expect(onHoverChange).toHaveBeenLastCalledWith(false);
  });

  it("handles primitive pin data by stringifying it", () => {
    render(<PinDataPreviewPopover pinData={"raw text"} onUnpin={() => {}} />);
    expect(screen.getByText("raw text")).toBeInTheDocument();
  });
});
