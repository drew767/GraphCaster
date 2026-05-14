// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

import { AutosaveIndicator } from "./AutosaveIndicator";
import { useAutosaveStore } from "../../stores/autosaveStore";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, defaultOrOpts?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
      const o = (typeof defaultOrOpts === "object" ? defaultOrOpts : opts) ?? {};
      const d =
        typeof defaultOrOpts === "string"
          ? defaultOrOpts
          : (o["defaultValue"] as string | undefined) ?? k;
      let out = d;
      for (const [key, val] of Object.entries(o)) {
        out = out.replace(`{{${key}}}`, String(val));
      }
      return out;
    },
  }),
}));

beforeEach(() => {
  useAutosaveStore.setState({ byWorkflow: {}, retryHandlers: {} });
});

describe("AutosaveIndicator", () => {
  it("renders nothing when no state for workflow", () => {
    const { container } = render(<AutosaveIndicator workflowId="wf-x" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders 'Saving…' while saving", () => {
    useAutosaveStore.getState().markSaving("wf-a");
    const { getByTestId } = render(<AutosaveIndicator workflowId="wf-a" />);
    const el = getByTestId("autosave-indicator");
    expect(el.getAttribute("data-state")).toBe("saving");
  });

  it("renders relative timestamp when saved", () => {
    const fixedNow = 1_700_000_000_000;
    useAutosaveStore.getState().markSaved("wf-b", fixedNow - 60_000);
    const { getByTestId } = render(
      <AutosaveIndicator workflowId="wf-b" now={() => fixedNow} />,
    );
    const el = getByTestId("autosave-indicator");
    expect(el.getAttribute("data-state")).toBe("saved");
    expect(el.textContent).toMatch(/1m ago/);
  });

  it("renders error and invokes retry handler on click", () => {
    const retry = vi.fn();
    useAutosaveStore.getState().registerRetry("wf-c", retry);
    useAutosaveStore.getState().markError("wf-c", new Error("boom"));
    const { getByTestId } = render(<AutosaveIndicator workflowId="wf-c" />);
    const btn = getByTestId("autosave-indicator");
    expect(btn.getAttribute("data-state")).toBe("error");
    fireEvent.click(btn);
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
