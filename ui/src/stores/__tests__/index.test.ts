// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

import * as stores from "../index";
import { useGraphStore } from "../graphStore";
import type { GraphDocumentJson } from "../../graph/types";

describe("stores/index re-exports", () => {
  it("exposes canonical stores", () => {
    expect(stores.useBannerStore).toBeDefined();
    expect(stores.useGraphMutationsStore).toBeDefined();
    expect(stores.useHistoryStore).toBeDefined();
    expect(stores.useThemeStore).toBeDefined();
    expect(stores.useWorkflowSettingsModalStore).toBeDefined();
  });

  it("exposes graph and settings stores", () => {
    expect(stores.useGraphStore).toBeDefined();
    expect(stores.useSettingsStore).toBeDefined();
  });

  it("does not re-export legacy app/stores", () => {
    const legacy = [
      "useAppBannerStore",
      "useAiContextStore",
      "useAutosaveStore",
      "useCommandBarStore",
      "useEditorUiStore",
      "useHeaderSlotStore",
      "useNotificationsStore",
      "usePresenceStore",
      "useRunStore",
      "useTagsStore",
      "useUIStore",
      "useWorkflowStore",
    ];
    for (const name of legacy) {
      expect((stores as Record<string, unknown>)[name]).toBeUndefined();
    }
  });
});

describe("useGraphStore", () => {
  beforeEach(() => {
    useGraphStore.setState({
      graphDocument: null,
      workspaceGraphsDir: null,
      workspaceIndex: [],
      layoutEpoch: 0,
    });
  });

  it("defaults graphDocument to null and layoutEpoch to 0", () => {
    const { result } = renderHook(() => useGraphStore());
    expect(result.current.graphDocument).toBeNull();
    expect(result.current.layoutEpoch).toBe(0);
    expect(result.current.workspaceIndex).toEqual([]);
  });

  it("setGraphDocument updates state", () => {
    const { result } = renderHook(() => useGraphStore());
    const doc = {
      schema: "graphcaster.graph/v1",
      meta: { name: "t" },
      nodes: [],
      edges: [],
    } as unknown as GraphDocumentJson;

    act(() => result.current.setGraphDocument(doc));
    expect(useGraphStore.getState().graphDocument).toBe(doc);
  });

  it("bumpLayoutEpoch increments monotonically", () => {
    const { result } = renderHook(() => useGraphStore());
    act(() => result.current.bumpLayoutEpoch());
    act(() => result.current.bumpLayoutEpoch());
    expect(useGraphStore.getState().layoutEpoch).toBe(2);
  });
});
