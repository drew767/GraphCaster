// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import WorkerViewPage from "./WorkerView";
import type { Worker } from "../../api/workers";

function seedWorkers(workers: Worker[]) {
  globalThis.localStorage.setItem("gc.workers", JSON.stringify(workers));
}

function renderPage() {
  return render(
    <MemoryRouter>
      <WorkerViewPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe("WorkerViewPage", () => {
  it("renders header, refresh button and auto-refresh toggle", async () => {
    seedWorkers([]);
    renderPage();
    expect(screen.getByTestId("workers-page")).toBeTruthy();
    expect(screen.getByTestId("workers-refresh-btn")).toBeTruthy();
    expect(screen.getByTestId("workers-auto-refresh-toggle")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText("app.settings.workers.emptyTitle")).toBeTruthy();
    });
  });

  it("renders worker rows from storage", async () => {
    const now = Date.now();
    seedWorkers([
      {
        id: "wrk-online-1",
        host: "host-a",
        lastHeartbeat: new Date(now - 5_000).toISOString(),
        runningRuns: 3,
        version: "1.0.0",
      },
    ]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("host-a")).toBeTruthy();
    });
    expect(screen.getByTestId("worker-runs-link-wrk-online-1")).toBeTruthy();
  });

  it("colors status correctly per heartbeat age", async () => {
    const now = Date.now();
    seedWorkers([
      {
        id: "wrk-online",
        host: "h1",
        lastHeartbeat: new Date(now - 5_000).toISOString(),
        runningRuns: 0,
        version: "1",
      },
      {
        id: "wrk-stale",
        host: "h2",
        lastHeartbeat: new Date(now - 60_000).toISOString(),
        runningRuns: 0,
        version: "1",
      },
      {
        id: "wrk-offline",
        host: "h3",
        lastHeartbeat: new Date(now - 5 * 60_000).toISOString(),
        runningRuns: 0,
        version: "1",
      },
    ]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("worker-status-wrk-online")).toBeTruthy();
    });

    expect(
      screen.getByTestId("worker-status-wrk-online").getAttribute("data-status"),
    ).toBe("online");
    expect(
      screen.getByTestId("worker-status-wrk-stale").getAttribute("data-status"),
    ).toBe("stale");
    expect(
      screen.getByTestId("worker-status-wrk-offline").getAttribute("data-status"),
    ).toBe("offline");
  });
});
