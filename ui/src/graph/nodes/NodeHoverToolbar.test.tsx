// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../components/ui/Icon/Icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

vi.mock("../../components/ui/Tooltip/Tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactElement }) => children,
}));

import { NodeHoverToolbar } from "./NodeHoverToolbar";

function renderToolbar(props: Partial<React.ComponentProps<typeof NodeHoverToolbar>> = {}) {
  return render(
    <NodeHoverToolbar
      nodeId="n1"
      isMuted={false}
      visible
      connectionDragActive={false}
      {...props}
    />,
  );
}

describe("NodeHoverToolbar", () => {
  it("renders nothing immediately on visible=true (waits for show delay)", () => {
    vi.useFakeTimers();
    try {
      renderToolbar();
      expect(screen.queryByTestId("node-hover-toolbar")).toBeNull();
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(screen.getByTestId("node-hover-toolbar")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders all six action buttons", () => {
    vi.useFakeTimers();
    try {
      renderToolbar();
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(screen.getByLabelText("canvas.node.toolbar.execute")).toBeInTheDocument();
      expect(screen.getByLabelText("canvas.node.toolbar.disable")).toBeInTheDocument();
      expect(screen.getByLabelText("canvas.node.toolbar.pin")).toBeInTheDocument();
      expect(screen.getByLabelText("canvas.node.toolbar.duplicate")).toBeInTheDocument();
      expect(screen.getByLabelText("canvas.node.toolbar.settings")).toBeInTheDocument();
      expect(screen.getByLabelText("canvas.node.toolbar.delete")).toBeInTheDocument();

      const toolbar = screen.getByTestId("node-hover-toolbar");
      const buttons = toolbar.querySelectorAll("button");
      expect(buttons.length).toBe(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses enable label when isMuted=true", () => {
    vi.useFakeTimers();
    try {
      renderToolbar({ isMuted: true });
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(screen.getByLabelText("canvas.node.toolbar.enable")).toBeInTheDocument();
      expect(screen.queryByLabelText("canvas.node.toolbar.disable")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("hides immediately when a connection drag is active", () => {
    vi.useFakeTimers();
    try {
      const { rerender } = renderToolbar();
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(screen.getByTestId("node-hover-toolbar")).toBeInTheDocument();

      rerender(
        <NodeHoverToolbar
          nodeId="n1"
          isMuted={false}
          visible={true}
          connectionDragActive={true}
        />,
      );
      expect(screen.queryByTestId("node-hover-toolbar")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("invokes onOpenSettings with the nodeId when settings button clicked", () => {
    vi.useFakeTimers();
    try {
      const onOpenSettings = vi.fn();
      renderToolbar({ onOpenSettings });
      act(() => {
        vi.advanceTimersByTime(100);
      });
      const btn = screen.getByLabelText("canvas.node.toolbar.settings");
      btn.click();
      expect(onOpenSettings).toHaveBeenCalledWith("n1");
    } finally {
      vi.useRealTimers();
    }
  });
});
