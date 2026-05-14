// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

const I18N_OVERRIDES: Record<string, string> = {
  "workflowHeader.namePlaceholder": "Untitled workflow",
  "workflowHeader.active.label": "Active",
  "workflowHeader.active.tooltipOn": "Workflow is active",
  "workflowHeader.active.tooltipOff": "Workflow is inactive",
  "workflowHeader.tags.addTags": "+ Add tags",
  "workflowHeader.tags.addTagsAria": "Add tags",
  "workflowHeader.tags.noTags": "No tags yet",
  "workflowHeader.tags.createPlaceholder": "Create new tag",
  "workflowHeader.execute.label": "Execute workflow",
  "workflowHeader.execute.pinnedLabel": "Execute with pinned data",
  "workflowHeader.execute.groupAria": "Execute workflow",
  "workflowHeader.execute.menuAria": "Execute options",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown> | string) => {
      const override = I18N_OVERRIDES[k];
      if (override !== undefined) {
        if (opts && typeof opts === "object") {
          let r = override;
          Object.entries(opts).forEach(([key, val]) => {
            r = r.replace(`{{${key}}}`, String(val));
          });
          return r;
        }
        return override;
      }
      if (typeof opts === "string") return opts;
      return k;
    },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

import { WorkflowHeader } from "../WorkflowHeader";
import { AppHeaderContent } from "../../../app/components/AppHeader/AppHeader";
import { useWorkflowStore } from "../../../app/stores/workflowStore";
import { useTagsStore } from "../../../app/stores/tagsStore";
import { useRunStore } from "../../../app/stores/runStore";
import { useHeaderSlotStore } from "../../../app/stores/headerSlotStore";
import { ToastProvider } from "../../../toast/ToastProvider";

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (typeof window !== "undefined" && !window.PointerEvent) {
    // @ts-expect-error - jsdom polyfill
    window.PointerEvent = class PointerEvent extends MouseEvent {
      constructor(type: string, init?: PointerEventInit) {
        super(type, init);
      }
    };
  }
  if (typeof window !== "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.HTMLElement.prototype as any).hasPointerCapture = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.HTMLElement.prototype as any).releasePointerCapture = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.HTMLElement.prototype as any).setPointerCapture = vi.fn();
    if (!window.HTMLElement.prototype.scrollIntoView) {
      window.HTMLElement.prototype.scrollIntoView = () => {};
    }
  }
});

function resetStores(id: string, init?: Partial<{ name: string; active: boolean; tags: string[] }>) {
  useHeaderSlotStore.getState().clear();
  useTagsStore.setState({ tags: [] });
  useRunStore.setState({ runs: [] });
  useWorkflowStore.setState({
    workflows: {
      [id]: {
        id,
        name: init?.name ?? "My Workflow",
        active: init?.active ?? false,
        tags: init?.tags ?? [],
      },
    },
  });
}

function renderHeader(id: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[`/workflow/${id}`]}>
        <Routes>
          <Route
            path="/workflow/:graphId"
            element={
              <>
                <AppHeaderContent workflowId={id} />
                <WorkflowHeader workflowId={id} />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe("WorkflowHeader — composition", () => {
  beforeEach(() => resetStores("wf-1"));

  it("renders name, active switch, tags trigger, and execute button", () => {
    renderHeader("wf-1");
    // Name shown via InlineTextEdit display
    expect(screen.getByText("My Workflow")).toBeInTheDocument();
    // Switch
    expect(screen.getByTestId("workflow-header-active-switch")).toBeInTheDocument();
    // Tags
    expect(screen.getByTestId("workflow-header-tags-trigger")).toBeInTheDocument();
    // Execute button (main)
    expect(screen.getByTestId("workflow-header-execute-main")).toBeInTheDocument();
    expect(screen.getByTestId("workflow-header-execute-chevron")).toBeInTheDocument();
  });
});

describe("WorkflowHeader — inline rename", () => {
  beforeEach(() => resetStores("wf-2", { name: "Original" }));

  it("calls renameWorkflow on commit", () => {
    renderHeader("wf-2");

    // Click the name to enter edit mode
    fireEvent.click(screen.getByText("Original"));
    const input = screen.getByDisplayValue("Original") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Renamed" } });
    // Commit via Enter (commitOn=both)
    fireEvent.keyDown(input, { key: "Enter" });

    expect(useWorkflowStore.getState().workflows["wf-2"].name).toBe("Renamed");
  });
});

describe("WorkflowHeader — active toggle", () => {
  beforeEach(() => resetStores("wf-3", { active: false }));

  it("calls setActive when toggled", () => {
    renderHeader("wf-3");
    const sw = screen.getByTestId("workflow-header-active-switch");
    fireEvent.click(sw);
    expect(useWorkflowStore.getState().workflows["wf-3"].active).toBe(true);
  });
});

describe("WorkflowHeader — tags popover", () => {
  beforeEach(() => resetStores("wf-4", { tags: [] }));

  it("opens popover and creates a new tag via Enter", async () => {
    renderHeader("wf-4");
    const trigger = screen.getByTestId("workflow-header-tags-trigger");
    await act(async () => {
      fireEvent.click(trigger);
    });

    const input = await screen.findByTestId("workflow-header-tags-create-input");
    fireEvent.change(input, { target: { value: "new-tag" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(useWorkflowStore.getState().workflows["wf-4"].tags).toContain("new-tag");
    expect(useTagsStore.getState().tags).toContain("new-tag");
  });
});

describe("WorkflowHeader — execute dropdown", () => {
  beforeEach(() => resetStores("wf-5"));

  it("main button calls startRun with useFreshData", () => {
    renderHeader("wf-5");
    fireEvent.click(screen.getByTestId("workflow-header-execute-main"));
    const runs = useRunStore.getState().runs;
    expect(runs).toHaveLength(1);
    expect(runs[0].workflowId).toBe("wf-5");
    expect(runs[0].options.useFreshData).toBe(true);
  });

  it("dropdown menu shows Execute and Execute with pinned data", async () => {
    renderHeader("wf-5");
    const chevron = screen.getByTestId("workflow-header-execute-chevron");
    act(() => {
      fireEvent.pointerDown(chevron, { button: 0, ctrlKey: false });
      fireEvent.click(chevron);
    });

    const items = await screen.findAllByRole("menuitem");
    const labels = items.map((el) => el.textContent ?? "");
    expect(labels.some((l) => l.includes("Execute workflow"))).toBe(true);
    expect(labels.some((l) => l.includes("Execute with pinned data"))).toBe(true);
  });

  it("pinned menu item calls startRun with usePinnedData", async () => {
    renderHeader("wf-5");
    const chevron = screen.getByTestId("workflow-header-execute-chevron");
    act(() => {
      fireEvent.pointerDown(chevron, { button: 0, ctrlKey: false });
      fireEvent.click(chevron);
    });

    const items = await screen.findAllByRole("menuitem");
    const pinned = items.find((el) =>
      (el.textContent ?? "").includes("Execute with pinned data"),
    );
    expect(pinned).toBeDefined();
    act(() => {
      fireEvent.click(pinned!);
    });

    const runs = useRunStore.getState().runs;
    expect(runs.some((r) => r.options.usePinnedData === true)).toBe(true);
  });
});
