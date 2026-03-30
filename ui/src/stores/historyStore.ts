// Copyright GraphCaster. All Rights Reserved.

import { create } from "zustand";

export interface RunSummary {
  runId: string;
  graphId: string;
  graphName: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  startedAt: string;
  finishedAt?: string;
  eventCount: number;
  trigger: string;
  /** Persisted run directory name (for NDJSON path). Defaults to `runId` when absent. */
  artifactRunDir?: string;
  /** Graph-tab: whether events.ndjson exists (persisted listing only). */
  hasEvents?: boolean;
}

export interface RunFilterState {
  graphId?: string;
  status?: string;
  startedAfter?: string;
  startedBefore?: string;
  search?: string;
}

export interface ReplayStateSnapshot {
  currentIndex: number;
  totalEvents: number;
  nodeStates: Record<string, string>;
  nodeOutputs: Record<string, unknown>;
  isPlaying: boolean;
}

export interface HistoryRunEvent {
  type: string;
  runId: string;
  nodeId?: string;
  timestamp: string;
  data: Record<string, unknown>;
  index: number;
}

interface HistoryState {
  runs: RunSummary[];
  totalCount: number;
  isLoading: boolean;
  error: string | null;
  filter: RunFilterState;
  page: number;
  pageSize: number;
  selectedRunId: string | null;
  selectedRun: RunSummary | null;
  events: HistoryRunEvent[];
  eventsLoading: boolean;
  replayState: ReplayStateSnapshot | null;
  setRuns: (runs: RunSummary[], totalCount?: number) => void;
  selectRun: (runId: string | null) => void;
  setFilter: (filter: Partial<RunFilterState>) => void;
  setPage: (page: number) => void;
  setEvents: (events: HistoryRunEvent[]) => void;
  setEventsLoading: (loading: boolean) => void;
  setReplayState: (state: ReplayStateSnapshot | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState = {
  runs: [] as RunSummary[],
  totalCount: 0,
  isLoading: false,
  error: null,
  filter: {} as RunFilterState,
  page: 1,
  pageSize: 20,
  selectedRunId: null as string | null,
  selectedRun: null as RunSummary | null,
  events: [] as HistoryRunEvent[],
  eventsLoading: false,
  replayState: null as ReplayStateSnapshot | null,
};

export const useHistoryStore = create<HistoryState>((set, get) => ({
  ...initialState,

  setRuns: (runs, totalCount) =>
    set({
      runs,
      totalCount: totalCount ?? runs.length,
    }),

  selectRun: (runId) => {
    const runs = get().runs;
    const selectedRun = runId == null ? null : runs.find((r) => r.runId === runId) ?? null;
    set({
      selectedRunId: runId,
      selectedRun,
      events: [],
      replayState: null,
    });
  },

  setFilter: (filter) =>
    set((state) => ({
      filter: { ...state.filter, ...filter },
      page: 1,
    })),

  setPage: (page) => set({ page }),

  setEvents: (events) => set({ events, eventsLoading: false }),

  setEventsLoading: (eventsLoading) => set({ eventsLoading }),

  setReplayState: (replayState) => set({ replayState }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error, isLoading: false }),

  reset: () => set(initialState),
}));
