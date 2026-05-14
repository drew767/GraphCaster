// Copyright GraphCaster. All Rights Reserved.

import { renderHook, act } from "@testing-library/react";
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

vi.mock("../../run/runCommands", () => ({
  gcCancelRun: vi.fn().mockResolvedValue(undefined),
  launchGcStartJob: vi.fn().mockResolvedValue(undefined),
  getRunEnvironmentInfo: vi
    .fn()
    .mockResolvedValue({ moduleAvailable: true, pythonPath: "/usr/bin/python3" }),
}));

vi.mock("../../run/tauriEnv", () => ({
  isTauriRuntime: () => false,
}));

import { useRunSessionController } from "./useRunSessionController";
import type { GraphCanvasHandle, GraphCanvasSelection } from "../../components/GraphCanvas";
import type { StructureIssue } from "../../graph/structureWarnings";

function makeCanvasRef(): { current: GraphCanvasHandle | null } {
  return {
    current: {
      exportDocument: () => ({
        schemaVersion: 1,
        meta: { graphId: "g1" },
        nodes: [{ id: "start", type: "start", position: { x: 0, y: 0 } }],
        edges: [],
      }),
    } as unknown as GraphCanvasHandle,
  };
}

function defaultOptions() {
  const canvasRef = makeCanvasRef();
  const selectionRef: { current: GraphCanvasSelection | null } = { current: null };
  return {
    canvasRef,
    selectionRef,
    structureIssues: [] as StructureIssue[],
    runSessionBlocking: false,
    selection: null as GraphCanvasSelection | null,
    pushToast: vi.fn(),
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("useRunSessionController", () => {
  it("initialises from localStorage defaults (all empty)", () => {
    const { result } = renderHook(() => useRunSessionController(defaultOptions()));
    expect(result.current.runGraphsDir).toBe("");
    expect(result.current.runArtifactsBase).toBe("");
    expect(result.current.stepCacheRunEnabled).toBe(false);
  });

  it("persists runGraphsDir to localStorage when set", () => {
    const { result } = renderHook(() => useRunSessionController(defaultOptions()));
    act(() => {
      result.current.setRunGraphsDir("/tmp/graphs");
    });
    expect(localStorage.getItem("gc.run.graphsDir")).toBe("/tmp/graphs");
    expect(result.current.runGraphsDir).toBe("/tmp/graphs");
  });

  it("disables runUntilSelectionEnabled when nothing is selected", () => {
    const { result } = renderHook(() => useRunSessionController(defaultOptions()));
    expect(result.current.runUntilSelectionEnabled).toBe(false);
  });

  it("disables stepCache when artifacts base becomes empty", () => {
    localStorage.setItem("gc.run.artifactsBase", "/tmp/artifacts");
    localStorage.setItem("gc.run.stepCacheEnabled", "1");
    const { result } = renderHook(() => useRunSessionController(defaultOptions()));
    expect(result.current.stepCacheRunEnabled).toBe(true);
    act(() => {
      result.current.setRunArtifactsBase("");
    });
    expect(result.current.stepCacheRunEnabled).toBe(false);
  });
});
