// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { ToastProvider, useToast } from "../ToastProvider";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function TestHarness({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

function ToastTrigger({
  onReady,
}: {
  onReady: (api: ReturnType<typeof useToast>) => void;
}) {
  const ctx = useToast();
  // Expose the api synchronously via callback on first render
  // Use ref pattern so it only fires once
  const fired = { current: false };
  if (!fired.current) {
    fired.current = true;
    onReady(ctx);
  }
  return null;
}

function renderWithProvider(ui: React.ReactNode = null) {
  let api: ReturnType<typeof useToast>;
  const result = render(
    <TestHarness>
      <ToastTrigger
        onReady={(a) => {
          api = a;
        }}
      />
      {ui}
    </TestHarness>,
  );
  return { ...result, getApi: () => api! };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ToastProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
  });

  // 1. Renders toast on toast.success("foo") — title visible
  it("shows a toast when toast.success is called with a string", () => {
    const { getApi } = renderWithProvider();
    act(() => {
      getApi().toast.success("Saved!");
    });
    expect(screen.getByText("Saved!")).toBeInTheDocument();
  });

  // 2. Different types apply correct icon class
  it("applies correct type class for each toast type", () => {
    const { getApi } = renderWithProvider();

    act(() => {
      getApi().toast.success("ok");
    });
    expect(document.querySelector(".gc-toast--success")).toBeInTheDocument();

    act(() => {
      getApi().toast.dismissAll();
    });

    act(() => {
      getApi().toast.error("fail");
    });
    expect(document.querySelector(".gc-toast--error")).toBeInTheDocument();

    act(() => {
      getApi().toast.dismissAll();
    });

    act(() => {
      getApi().toast.warning("warn");
    });
    expect(document.querySelector(".gc-toast--warning")).toBeInTheDocument();

    act(() => {
      getApi().toast.dismissAll();
    });

    act(() => {
      getApi().toast.info("info");
    });
    expect(document.querySelector(".gc-toast--info")).toBeInTheDocument();
  });

  // 3. duration=0 → no auto-dismiss (wait 200ms, still present)
  it("stays visible with duration=0 (sticky)", () => {
    const { getApi } = renderWithProvider();
    act(() => {
      getApi().toast.show({ message: "sticky", type: "info", duration: 0 });
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByText("sticky")).toBeInTheDocument();
  });

  // 4. duration=100 → auto-dismiss after timer
  it("auto-dismisses after the specified duration", async () => {
    const { getApi } = renderWithProvider();
    act(() => {
      getApi().toast.show({ message: "short-lived", type: "info", duration: 100 });
    });
    expect(screen.getByText("short-lived")).toBeInTheDocument();
    // Advance past duration + exit animation (220ms)
    act(() => {
      vi.advanceTimersByTime(100 + 300);
    });
    expect(screen.queryByText("short-lived")).not.toBeInTheDocument();
  });

  // 5. Queue overflow: 6 toasts shown, oldest disappears
  it("auto-removes oldest when more than 5 toasts are added", async () => {
    const { getApi } = renderWithProvider();
    const ids: string[] = [];
    act(() => {
      for (let i = 0; i < 6; i++) {
        ids.push(
          getApi().toast.show({ message: `toast-${i}`, type: "info", duration: 0 }),
        );
      }
    });
    // Flush the timeout that schedules the oldest exit
    act(() => {
      vi.advanceTimersByTime(0);
    });
    // Give exit animation time to complete (220ms)
    act(() => {
      vi.advanceTimersByTime(300);
    });
    // toast-0 should be gone
    expect(screen.queryByText("toast-0")).not.toBeInTheDocument();
    // toast-1 through toast-5 should still be present
    expect(screen.getByText("toast-5")).toBeInTheDocument();
  });

  // 6. Action button: visible, click fires
  it("renders action button and fires onClick on click", () => {
    const onAction = vi.fn();
    const { getApi } = renderWithProvider();
    act(() => {
      getApi().toast.show({
        message: "with-action",
        type: "info",
        action: { label: "Retry", onClick: onAction },
      });
    });
    const btn = screen.getByRole("button", { name: "Retry" });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  // 7. Dismiss button works
  it("dismisses toast when dismiss button is clicked", async () => {
    const { getApi } = renderWithProvider();
    act(() => {
      getApi().toast.show({ message: "dismissable", type: "info", duration: 0 });
    });
    expect(screen.getByText("dismissable")).toBeInTheDocument();
    const dismissBtn = screen.getByRole("button", { name: "Dismiss notification" });
    fireEvent.click(dismissBtn);
    // Advance past exit animation
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByText("dismissable")).not.toBeInTheDocument();
  });

  // 8. Click on toast fires onClick
  it("fires onClick when clicking the toast body", () => {
    const onClick = vi.fn();
    const { getApi } = renderWithProvider();
    act(() => {
      getApi().toast.show({
        message: "clickable-toast",
        type: "info",
        onClick,
        duration: 0,
      });
    });
    const toast = screen.getByText("clickable-toast").closest(".gc-toast")!;
    fireEvent.click(toast);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  // 9. Same id replaces existing toast
  it("replaces existing toast when same id is used", () => {
    const { getApi } = renderWithProvider();
    act(() => {
      getApi().toast.show({ message: "original", type: "info", id: "dup", duration: 0 });
    });
    expect(screen.getByText("original")).toBeInTheDocument();

    act(() => {
      getApi().toast.show({ message: "replaced", type: "success", id: "dup", duration: 0 });
    });
    expect(screen.queryByText("original")).not.toBeInTheDocument();
    expect(screen.getByText("replaced")).toBeInTheDocument();
  });

  // 10. dismissAll() clears all
  it("clears all toasts on dismissAll()", async () => {
    const { getApi } = renderWithProvider();
    act(() => {
      getApi().toast.show({ message: "a", type: "info", duration: 0 });
      getApi().toast.show({ message: "b", type: "success", duration: 0 });
      getApi().toast.show({ message: "c", type: "error", duration: 0 });
    });
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
    expect(screen.getByText("c")).toBeInTheDocument();

    act(() => {
      getApi().toast.dismissAll();
    });

    expect(screen.queryByText("a")).not.toBeInTheDocument();
    expect(screen.queryByText("b")).not.toBeInTheDocument();
    expect(screen.queryByText("c")).not.toBeInTheDocument();
  });

  // 11. Legacy push() API still works
  it("supports legacy push(message, variant) API", () => {
    const { getApi } = renderWithProvider();
    act(() => {
      getApi().push("legacy message", "success");
    });
    expect(screen.getByText("legacy message")).toBeInTheDocument();
    expect(document.querySelector(".gc-toast--success")).toBeInTheDocument();
  });

  // 12. Legacy push() with 'warn' variant maps to warning type
  it("maps legacy warn variant to warning type", () => {
    const { getApi } = renderWithProvider();
    act(() => {
      getApi().push("a warning", "warn");
    });
    expect(document.querySelector(".gc-toast--warning")).toBeInTheDocument();
  });

  // 13. toast.error with options object (title + action)
  it("renders title and message from options object", () => {
    const { getApi } = renderWithProvider();
    act(() => {
      getApi().toast.error({ title: "Failed", message: "Try again" });
    });
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Try again")).toBeInTheDocument();
  });

  // 14. Telemetry: onShow callback is called
  it("calls onShow callback when a toast is shown", () => {
    const onShow = vi.fn();
    let api: ReturnType<typeof useToast>;
    render(
      <ToastProvider onShow={onShow}>
        <ToastTrigger onReady={(a) => { api = a; }} />
      </ToastProvider>,
    );
    act(() => {
      api!.toast.info("telemetry test");
    });
    expect(onShow).toHaveBeenCalledTimes(1);
    expect(onShow.mock.calls[0][0]).toMatchObject({ message: "telemetry test" });
  });

  // 15. Telemetry: onDismiss callback is called
  it("calls onDismiss callback when a toast is dismissed", async () => {
    const onDismiss = vi.fn();
    let api: ReturnType<typeof useToast>;
    render(
      <ToastProvider onDismiss={onDismiss}>
        <ToastTrigger onReady={(a) => { api = a; }} />
      </ToastProvider>,
    );
    act(() => {
      api!.toast.show({ message: "will dismiss", duration: 0 });
    });
    const dismissBtn = screen.getByRole("button", { name: "Dismiss notification" });
    fireEvent.click(dismissBtn);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
