// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import React from "react";

import { OutputView } from "../output/OutputView";
import { useNdvStore } from "../useNdvStore";

beforeEach(() => {
  act(() => {
    useNdvStore.setState({
      activeNodeId: null,
      activeNodeType: null,
      panelWidths: {},
      inputView: {},
      outputView: {},
      itemIndex: {},
    });
  });
  localStorage.clear();
});

describe("OutputView — binary view", () => {
  it("renders image when item has image binary", () => {
    const data = [
      {
        json: { name: "img" },
        binary: {
          file: {
            fileType: "image",
            mimeType: "image/png",
            data: "iVBORw0KGgoAAAANS",
            fileName: "pic.png",
            fileSize: 1024,
          },
        },
      },
    ];
    render(<OutputView nodeId="n1" data={data} />);
    // Switch to binary tab
    const binaryTab = screen.getByRole("tab", { name: /binary/i });
    fireEvent.mouseDown(binaryTab, { button: 0 });
    const img = screen.getByRole("img");
    expect(img).toBeInTheDocument();
    expect((img as HTMLImageElement).src).toContain("data:image/png;base64,");
  });

  it("does not show binary tab when no binary present", () => {
    render(<OutputView nodeId="n2" data={[{ json: { a: 1 } }]} />);
    const tabs = screen.queryAllByRole("tab");
    const labels = tabs.map((t) => t.textContent ?? "");
    expect(labels.some((l) => /binary/i.test(l))).toBe(false);
  });
});

describe("OutputView — pin button", () => {
  it("calls onTogglePin with toggled state and current data", () => {
    const onTogglePin = vi.fn();
    const data = [{ json: { a: 1 } }];
    const { rerender } = render(
      <OutputView nodeId="n3" data={data} pinned={false} onTogglePin={onTogglePin} />,
    );
    const btn = screen.getByTestId("output-pin-button");
    expect(btn.getAttribute("data-pinned")).toBe("false");
    fireEvent.click(btn);
    expect(onTogglePin).toHaveBeenCalledWith(true, data);
    rerender(<OutputView nodeId="n3" data={data} pinned={true} onTogglePin={onTogglePin} />);
    const btn2 = screen.getByTestId("output-pin-button");
    expect(btn2.getAttribute("data-pinned")).toBe("true");
    fireEvent.click(btn2);
    expect(onTogglePin).toHaveBeenLastCalledWith(false, data);
  });
});

describe("OutputView — arrow item navigation", () => {
  it("clamps at lower bound (cannot go below 0)", () => {
    const data = [{ a: 1 }, { a: 2 }, { a: 3 }];
    render(<OutputView nodeId="n4" data={data} />);
    const label = screen.getByTestId("item-nav-label");
    expect(label.textContent).toBe("1/3");
    // Press [ at index 0 — should clamp at 0
    fireEvent.keyDown(window, { key: "[" });
    expect(screen.getByTestId("item-nav-label").textContent).toBe("1/3");
  });

  it("clamps at upper bound (cannot exceed N-1)", () => {
    const data = [{ a: 1 }, { a: 2 }];
    render(<OutputView nodeId="n5" data={data} />);
    // advance twice — should clamp at item 2/2
    fireEvent.keyDown(window, { key: "]" });
    expect(screen.getByTestId("item-nav-label").textContent).toBe("2/2");
    fireEvent.keyDown(window, { key: "]" });
    expect(screen.getByTestId("item-nav-label").textContent).toBe("2/2");
  });

  it("navigates between items via [ and ] keys", () => {
    const data = [{ a: 1 }, { a: 2 }, { a: 3 }];
    render(<OutputView nodeId="n6" data={data} />);
    fireEvent.keyDown(window, { key: "]" });
    expect(screen.getByTestId("item-nav-label").textContent).toBe("2/3");
    fireEvent.keyDown(window, { key: "]" });
    expect(screen.getByTestId("item-nav-label").textContent).toBe("3/3");
    fireEvent.keyDown(window, { key: "[" });
    expect(screen.getByTestId("item-nav-label").textContent).toBe("2/3");
  });

  it("hides navigator when array has ≤1 items", () => {
    render(<OutputView nodeId="n7" data={[{ a: 1 }]} />);
    expect(screen.queryByTestId("item-navigator")).toBeNull();
  });
});
