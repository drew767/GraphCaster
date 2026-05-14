// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock("../../ui/Icon/Icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

let mockTx = 0;
let mockTy = 0;
let mockZoom = 1;

vi.mock("@xyflow/react", () => ({
  MiniMap: ({ style, bgColor }: { style?: React.CSSProperties; bgColor?: string }) => (
    <div
      data-testid="minimap"
      data-bg={bgColor}
      style={style}
    />
  ),
  useStore: (selector: (s: { transform: [number, number, number] }) => unknown) =>
    selector({ transform: [mockTx, mockTy, mockZoom] }),
}));

vi.mock("../../../lib/usePrefersColorSchemeDark", () => ({
  usePrefersColorSchemeDark: () => false,
}));

import { AutoHideMiniMap } from "../AutoHideMiniMap";

describe("AutoHideMiniMap", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockTx = 0;
    mockTy = 0;
    mockZoom = 1;
  });

  afterEach(() => {
    act(() => {
      vi.runAllTimers();
    });
    vi.useRealTimers();
  });

  it("renders MiniMap component", () => {
    const { getByTestId } = render(<AutoHideMiniMap />);
    expect(getByTestId("minimap")).not.toBeNull();
  });

  it("shows minimap after mount (viewport effect fires on initial render)", () => {
    const { container } = render(<AutoHideMiniMap />);
    const wrapper = container.querySelector(".gc-auto-minimap") as HTMLElement | null;
    expect(wrapper?.dataset.visible).toBe("true");
  });

  it("hides after 1000ms of inactivity", () => {
    const { container } = render(<AutoHideMiniMap />);
    const wrapper = container.querySelector(".gc-auto-minimap") as HTMLElement | null;
    expect(wrapper?.dataset.visible).toBe("true");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(wrapper?.dataset.visible).toBe("false");
  });

  it("re-shows when viewport moves again after hiding", () => {
    const { container, rerender } = render(<AutoHideMiniMap />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const wrapper = container.querySelector(".gc-auto-minimap") as HTMLElement | null;
    expect(wrapper?.dataset.visible).toBe("false");
    act(() => {
      mockTx = 50;
      rerender(<AutoHideMiniMap />);
    });
    expect(wrapper?.dataset.visible).toBe("true");
  });

  it("passes light chrome bgColor when not dark", () => {
    const { getByTestId } = render(<AutoHideMiniMap />);
    const mm = getByTestId("minimap");
    expect(mm.getAttribute("data-bg")).toBe("#ffffff");
  });
});
