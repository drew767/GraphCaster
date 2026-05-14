// Copyright GraphCaster. All Rights Reserved.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  EDITOR_UI_LOCK_KEY,
  EDITOR_UI_SNAP_KEY,
  useEditorUiStore,
} from "./editorUiStore";

describe("editorUiStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useEditorUiStore.setState({ snapToGrid: false, canvasLocked: false });
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("initial state defaults to false / false", () => {
    const s = useEditorUiStore.getState();
    expect(s.snapToGrid).toBe(false);
    expect(s.canvasLocked).toBe(false);
  });

  it("setSnapToGrid persists to localStorage under gc.editor.snap", () => {
    useEditorUiStore.getState().setSnapToGrid(true);
    expect(useEditorUiStore.getState().snapToGrid).toBe(true);
    expect(window.localStorage.getItem(EDITOR_UI_SNAP_KEY)).toBe("1");
    useEditorUiStore.getState().setSnapToGrid(false);
    expect(window.localStorage.getItem(EDITOR_UI_SNAP_KEY)).toBe("0");
  });

  it("setCanvasLocked persists to localStorage under gc.editor.lock", () => {
    useEditorUiStore.getState().setCanvasLocked(true);
    expect(useEditorUiStore.getState().canvasLocked).toBe(true);
    expect(window.localStorage.getItem(EDITOR_UI_LOCK_KEY)).toBe("1");
  });

  it("toggle helpers flip the flag and persist", () => {
    useEditorUiStore.getState().toggleSnapToGrid();
    expect(useEditorUiStore.getState().snapToGrid).toBe(true);
    expect(window.localStorage.getItem(EDITOR_UI_SNAP_KEY)).toBe("1");

    useEditorUiStore.getState().toggleCanvasLocked();
    expect(useEditorUiStore.getState().canvasLocked).toBe(true);
    expect(window.localStorage.getItem(EDITOR_UI_LOCK_KEY)).toBe("1");
  });
});
