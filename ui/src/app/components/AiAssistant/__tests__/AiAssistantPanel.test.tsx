// Copyright GraphCaster. All Rights Reserved.

import { render, screen, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && typeof opts === "object") {
        let s = key;
        for (const [k, v] of Object.entries(opts)) {
          s = s.replace(`{{${k}}}`, String(v));
        }
        return s;
      }
      return key;
    },
  }),
}));

import {
  AiAssistantPanel,
  AiAssistantTrigger,
  useAiAssistantStore,
} from "../AiAssistantPanel";

function resetStore() {
  act(() => {
    useAiAssistantStore.getState().setOpen(false);
  });
}

describe("AiAssistantPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore();
  });

  it("does not render the panel when closed", () => {
    render(<AiAssistantPanel />);
    expect(screen.queryByTestId("ai-assistant-panel")).not.toBeInTheDocument();
  });

  it("renders empty state and persists open state to localStorage when opened", () => {
    render(
      <>
        <AiAssistantTrigger />
        <AiAssistantPanel />
      </>,
    );
    act(() => {
      useAiAssistantStore.getState().setOpen(true);
    });
    expect(screen.getByTestId("ai-assistant-panel")).toBeInTheDocument();
    expect(screen.getByTestId("ai-assistant-empty")).toBeInTheDocument();
    expect(localStorage.getItem("gc.aiAssistant.open")).toBe("true");
  });

  it("toggles via the trigger button and persists the closed state", () => {
    render(
      <>
        <AiAssistantTrigger />
        <AiAssistantPanel />
      </>,
    );
    act(() => {
      useAiAssistantStore.getState().toggle();
    });
    expect(screen.getByTestId("ai-assistant-panel")).toBeInTheDocument();
    expect(localStorage.getItem("gc.aiAssistant.open")).toBe("true");

    act(() => {
      useAiAssistantStore.getState().toggle();
    });
    expect(screen.queryByTestId("ai-assistant-panel")).not.toBeInTheDocument();
    expect(localStorage.getItem("gc.aiAssistant.open")).toBe("false");
  });

  it("closes when X button clicked", () => {
    render(<AiAssistantPanel />);
    act(() => {
      useAiAssistantStore.getState().setOpen(true);
    });
    const close = screen.getByTestId("ai-assistant-close");
    act(() => {
      close.click();
    });
    expect(screen.queryByTestId("ai-assistant-panel")).not.toBeInTheDocument();
  });
});
