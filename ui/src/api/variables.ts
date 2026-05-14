// Copyright GraphCaster. All Rights Reserved.

export type VariableType = "string" | "number" | "boolean" | "json";

export interface Variable {
  id: string;
  key: string;
  value: unknown;
  type: VariableType;
  isSecret: boolean;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VariableInput {
  key: string;
  value: unknown;
  type: VariableType;
  isSecret: boolean;
  description?: string;
}

const STORAGE_KEY = "gc.variables";

function safeGetStorage(): Storage | null {
  try {
    if (typeof globalThis !== "undefined" && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

function readAll(): Variable[] {
  const storage = safeGetStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Variable[]) : [];
  } catch {
    return [];
  }
}

function writeAll(items: Variable[]): void {
  const storage = safeGetStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* quota or serialization error — swallow */
  }
}

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export const variablesApi = {
  async list(): Promise<Variable[]> {
    return readAll();
  },

  async create(input: VariableInput): Promise<Variable> {
    const items = readAll();
    if (items.some((v) => v.key === input.key)) {
      throw new Error("duplicate_key");
    }
    const now = new Date().toISOString();
    const variable: Variable = {
      id: makeId(),
      key: input.key,
      value: input.value,
      type: input.type,
      isSecret: input.isSecret,
      description: input.description,
      createdAt: now,
      updatedAt: now,
    };
    items.push(variable);
    writeAll(items);
    return variable;
  },

  async update(id: string, patch: Partial<VariableInput>): Promise<Variable> {
    const items = readAll();
    const idx = items.findIndex((v) => v.id === id);
    if (idx === -1) {
      throw new Error("not_found");
    }
    if (patch.key && items.some((v) => v.id !== id && v.key === patch.key)) {
      throw new Error("duplicate_key");
    }
    const merged: Variable = {
      ...items[idx],
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    items[idx] = merged;
    writeAll(items);
    return merged;
  },

  async delete(id: string): Promise<void> {
    const items = readAll();
    const next = items.filter((v) => v.id !== id);
    writeAll(next);
  },
};

export const VARIABLE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

export function isValidVariableKey(key: string): boolean {
  return VARIABLE_KEY_PATTERN.test(key);
}
