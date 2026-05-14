// Copyright GraphCaster. All Rights Reserved.

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PausedRunsBadge } from "../PausedRunsBadge";
import type { PausedRunItem } from "../types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "app.pausedRuns.badge": "Paused",
        "app.pausedRuns.title": "Paused run",
        "app.pausedRuns.prompt": "Prompt",
        "app.pausedRuns.submitText": "Submit",
        "app.pausedRuns.submitApprove": "Approve",
        "app.pausedRuns.submitReject": "Reject",
        "app.pausedRuns.noRuns": "No paused runs",
        "app.pausedRuns.loading": "Loading...",
        "app.pausedRuns.errorLoad": "Failed to load",
        "app.pausedRuns.errorSubmit": "Failed to submit",
        "app.pausedRuns.respondedByPlaceholder": "Your name",
        "app.pausedRuns.textPlaceholder": "Your answer...",
        "app.pausedRuns.jsonPlaceholder": "Enter JSON...",
      };
      return map[key] ?? key;
    },
  }),
}));

const mockItems: PausedRunItem[] = [
  {
    runId: "run-test-1",
    graphId: "g-test",
    pausedAtNode: "hi1",
    prompt: "Do you approve this action?",
    kind: "approval",
    choices: null,
    pausedAt: "2026-05-12T10:00:00+00:00",
    timeoutSec: 0,
  },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllTimers();
});

describe("PausedRunsBadge", () => {
  it("renders count badge when paused runs exist", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ items: mockItems }),
    });

    render(<PausedRunsBadge apiBase="/api/v1" />);

    await waitFor(() => {
      const badge = screen.getByTestId("paused-count");
      expect(badge.textContent).toBe("1");
    });
  });

  it("renders nothing when no paused runs", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    });

    const { container } = render(<PausedRunsBadge apiBase="/api/v1" />);

    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it("opens dropdown on click and shows prompt text", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ items: mockItems }),
    });

    render(<PausedRunsBadge apiBase="/api/v1" />);

    await waitFor(() => screen.getByTestId("paused-count"));

    const badge = screen.getByRole("button", { name: /paused/i });
    fireEvent.click(badge);

    expect(screen.getByText("Do you approve this action?")).toBeTruthy();
  });

  it("opens HumanInputModal on Submit click and shows Approve/Reject for approval kind", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ items: mockItems }),
    });

    render(<PausedRunsBadge apiBase="/api/v1" />);

    await waitFor(() => screen.getByTestId("paused-count"));

    fireEvent.click(screen.getByRole("button", { name: /paused/i }));

    const submitBtn = screen.getByText("Submit");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Paused run" })).toBeTruthy();
      expect(screen.getByText("Approve")).toBeTruthy();
      expect(screen.getByText("Reject")).toBeTruthy();
    });
  });

  it("submits approval=true via resume API", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: mockItems }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ runId: "run-test-1", status: "resumed" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [] }),
      });

    render(<PausedRunsBadge apiBase="/api/v1" />);

    await waitFor(() => screen.getByTestId("paused-count"));

    fireEvent.click(screen.getByRole("button", { name: /paused/i }));
    fireEvent.click(screen.getByText("Submit"));

    await waitFor(() => screen.getByText("Approve"));

    fireEvent.click(screen.getByText("Approve"));

    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(
        (c: [string, RequestInit]) => typeof c[0] === "string" && (c[0] as string).includes("/resume")
      );
      expect(calls.length).toBeGreaterThan(0);
      const body = JSON.parse((calls[0][1] as { body: string }).body) as { nodeId: string; payload: boolean };
      expect(body.nodeId).toBe("hi1");
      expect(body.payload).toBe(true);
    });
  });
});
