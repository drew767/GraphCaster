// Copyright GraphCaster. All Rights Reserved.

export interface WorkflowSettingsPayload {
  description?: string;
  tags?: string[];
  timezone?: string;
  saveManualExecutions?: boolean;
  saveSuccessData?: boolean;
  saveErrorData?: boolean;
  saveDataOnFailure?: boolean;
  errorWorkflowId?: string | null;
  callerPolicy?: "any" | "workspace" | "specific";
  callerPolicyWorkflowIds?: string[];
}

export interface DuplicateWorkflowPayload {
  name: string;
  projectId?: string;
  tags?: string[];
}

export interface MoveWorkflowPayload {
  projectId?: string;
  folderId?: string | null;
}

export interface WorkflowSummary {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
}

export interface WorkflowsApi {
  updateSettings: (id: string, settings: WorkflowSettingsPayload) => Promise<void>;
  duplicate: (
    id: string,
    payload: DuplicateWorkflowPayload,
  ) => Promise<{ id: string; name: string }>;
  move: (id: string, payload: MoveWorkflowPayload) => Promise<void>;
  get: (id: string) => Promise<WorkflowSummary | null>;
  create: (payload: Record<string, unknown>) => Promise<{ id: string; name: string }>;
  list: () => Promise<WorkflowSummary[]>;
}

function lsKey(id: string): string {
  return `gc.workflow.settings.${id}`;
}

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `wf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export const workflowsApi: WorkflowsApi = {
  async updateSettings(id, settings) {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(lsKey(id), JSON.stringify(settings));
      }
    } catch {
      // localStorage may be unavailable.
    }
  },
  async duplicate(_id, payload) {
    const newId = makeId();
    return { id: newId, name: payload.name };
  },
  async move(_id, _payload) {
    // Local stub — production deployment wires a real REST call.
  },
  async get(_id) {
    return null;
  },
  async create(payload) {
    const name = typeof payload.name === "string" ? payload.name : "Untitled";
    return { id: makeId(), name };
  },
  async list() {
    return [];
  },
};
