// Copyright GraphCaster. All Rights Reserved.

/**
 * Canvas / editor preferences store. Hydrates from localStorage on first use
 * via the existing `read*` helpers in `ui/src/graph/canvasXxx.ts` and writes
 * through to localStorage on action calls (single source of truth).
 *
 * MAY:
 * - Hold snapGrid / edgeLabels / ghostOffViewport / runMotion / followRun.
 * - Hydrate from and persist to localStorage via the canvas* helpers.
 *
 * MUST NOT:
 * - Know about React Flow nodes/edges (renderer-local).
 * - Hold graphDocument or run state (those have dedicated stores).
 * - Introduce a second persistence mechanism — localStorage helpers are SSOT.
 *
 * Note: AppShell still owns these as local useState during the transition;
 * this store is the migration target. Do NOT wire it into components in this
 * PR.
 */

import { create } from "zustand";
import {
  readEdgeLabelsEnabled,
  writeEdgeLabelsEnabled,
} from "../graph/canvasEdgeLabels";
import {
  readFollowRunPreference,
  writeFollowRunPreference,
} from "../graph/canvasFollowRun";
import {
  readGhostOffViewportEnabled,
  writeGhostOffViewportEnabled,
} from "../graph/canvasGhostOffViewport";
import {
  readRunMotionPreference,
  writeRunMotionPreference,
  type RunMotionPreference,
} from "../graph/canvasRunMotion";
import {
  readSnapGridEnabled,
  writeSnapGridEnabled,
} from "../graph/canvasSnapGrid";

export interface SettingsState {
  snapGridEnabled: boolean;
  edgeLabelsEnabled: boolean;
  ghostOffViewportEnabled: boolean;
  runMotion: RunMotionPreference;
  followRun: boolean;
  setSnapGridEnabled: (enabled: boolean) => void;
  setEdgeLabelsEnabled: (enabled: boolean) => void;
  setGhostOffViewportEnabled: (enabled: boolean) => void;
  setRunMotion: (mode: RunMotionPreference) => void;
  setFollowRun: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  snapGridEnabled: readSnapGridEnabled(),
  edgeLabelsEnabled: readEdgeLabelsEnabled(),
  ghostOffViewportEnabled: readGhostOffViewportEnabled(),
  runMotion: readRunMotionPreference(),
  followRun: readFollowRunPreference(),
  setSnapGridEnabled: (enabled) => {
    writeSnapGridEnabled(enabled);
    set({ snapGridEnabled: enabled });
  },
  setEdgeLabelsEnabled: (enabled) => {
    writeEdgeLabelsEnabled(enabled);
    set({ edgeLabelsEnabled: enabled });
  },
  setGhostOffViewportEnabled: (enabled) => {
    writeGhostOffViewportEnabled(enabled);
    set({ ghostOffViewportEnabled: enabled });
  },
  setRunMotion: (mode) => {
    writeRunMotionPreference(mode);
    set({ runMotion: mode });
  },
  setFollowRun: (enabled) => {
    writeFollowRunPreference(enabled);
    set({ followRun: enabled });
  },
}));
