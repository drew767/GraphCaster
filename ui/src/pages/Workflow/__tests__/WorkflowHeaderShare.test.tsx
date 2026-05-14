// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

import { WorkflowHeader } from "../WorkflowHeader";
import { AppHeaderContent } from "../../../app/components/AppHeader/AppHeader";
import { ToastProvider } from "../../../toast/ToastProvider";
import { useWorkflowStore } from "../../../app/stores/workflowStore";
import { useTagsStore } from "../../../app/stores/tagsStore";
import { useRunStore } from "../../../app/stores/runStore";
import { useHeaderSlotStore } from "../../../app/stores/headerSlotStore";

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
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

function resetStores(id: string) {
  useHeaderSlotStore.getState().clear();
  useTagsStore.setState({ tags: [] });
  useRunStore.setState({ runs: [] });
  useWorkflowStore.setState({
    workflows: {
      [id]: { id, name: "My Workflow", active: false, tags: [] },
    },
  });
  localStorage.clear();
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

describe("WorkflowHeader — Share button", () => {
  beforeEach(() => resetStores("wf-share-1"));

  it("renders a Share button", () => {
    renderHeader("wf-share-1");
    expect(screen.getByTestId("workflow-header-share-btn")).toBeInTheDocument();
  });

  it("opens the ShareModal when Share button is clicked", () => {
    renderHeader("wf-share-1");
    expect(screen.queryByTestId("workflow-share-modal")).toBeNull();

    act(() => {
      fireEvent.click(screen.getByTestId("workflow-header-share-btn"));
    });

    expect(screen.getByTestId("workflow-share-modal")).toBeInTheDocument();
  });
});
