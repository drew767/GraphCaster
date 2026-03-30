// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../run/runCommands", () => ({
  gcListPersistedRuns: vi.fn().mockResolvedValue([]),
  gcListRunCatalog: vi.fn().mockResolvedValue([]),
  gcReadPersistedRunEvents: vi.fn().mockResolvedValue({ text: "", truncated: false }),
  gcRebuildRunCatalog: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => {
      if (key === "app.runHistory.title") {
        return "Run history";
      }
      if (key === "app.runHistory.eventsSuffix") {
        return "events";
      }
      if (key === "app.runHistory.loading") {
        return "Loading…";
      }
      if (key === "app.runHistory.empty") {
        return "No runs";
      }
      if (key === "app.runHistory.tabGraph") {
        return "This graph";
      }
      if (key === "app.runHistory.tabWorkspace") {
        return "Workspace";
      }
      if (key === "app.runHistory.refresh") {
        return "Refresh";
      }
      if (key === "app.runHistory.close") {
        return "Close";
      }
      if (key === "app.runHistory.scopeAria") {
        return "Scope";
      }
      return typeof opts?.defaultValue === "string" ? opts.defaultValue : key;
    },
  }),
}));

import { waitFor } from "@testing-library/react";

import * as runCommands from "../../run/runCommands";
import { useHistoryStore } from "../../stores/historyStore";
import { HistoryModal } from "./HistoryModal";

describe("HistoryModal", () => {
  afterEach(() => {
    cleanup();
    useHistoryStore.getState().reset();
  });

  const props = {
    isOpen: true,
    onClose: vi.fn(),
    artifactsBase: "/tmp/artifacts",
    graphId: "g1",
  };

  it("renders when open", () => {
    render(<HistoryModal {...props} />);
    expect(screen.getByText("Run history")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(<HistoryModal {...props} isOpen={false} />);
    expect(screen.queryByText("Run history")).not.toBeInTheDocument();
  });

  it("shows run list from persisted listing", async () => {
    vi.mocked(runCommands.gcListPersistedRuns).mockResolvedValueOnce([
      { runDirName: "run-a", hasEvents: true, hasSummary: true },
    ]);

    render(<HistoryModal {...props} />);
    await waitFor(() => {
      expect(screen.getByText("run-a")).toBeInTheDocument();
    });
  });

  it("switches detail tabs when run selected", async () => {
    vi.mocked(runCommands.gcListPersistedRuns).mockResolvedValueOnce([
      { runDirName: "run-b", hasEvents: true, hasSummary: true },
    ]);

    render(<HistoryModal {...props} />);
    await waitFor(() => {
      expect(screen.getByText("run-b")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("run-b"));
    fireEvent.click(screen.getByRole("tab", { name: "Events" }));
    expect(screen.getByRole("tab", { name: "Events" })).toHaveAttribute("aria-selected", "true");
  });
});
