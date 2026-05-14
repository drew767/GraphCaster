// Copyright GraphCaster. All Rights Reserved.

export const VARIABLES_STORAGE_KEY = "gc.variables";
export const VARIABLE_KEY_REGEX = /^[a-z][a-z0-9_]*$/;

export type VariableType = "string" | "number" | "boolean" | "json";

export type VariableValue = string | number | boolean | unknown;

export type Variable = {
  id: string;
  key: string;
  type: VariableType;
  value: VariableValue;
  isSecret: boolean;
  description?: string;
  modifiedAt: string;
};

export type VariableInput = Omit<Variable, "id" | "modifiedAt"> & {
  id?: string;
};

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function isValidVariableKey(key: string): boolean {
  return VARIABLE_KEY_REGEX.test(key);
}

export function loadVariables(): Variable[] {
  const s = safeStorage();
  if (!s) return [];
  try {
    const raw = s.getItem(VARIABLES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is Variable => {
      return (
        v &&
        typeof v === "object" &&
        typeof v.id === "string" &&
        typeof v.key === "string" &&
        typeof v.type === "string" &&
        typeof v.isSecret === "boolean" &&
        typeof v.modifiedAt === "string"
      );
    });
  } catch {
    return [];
  }
}

export function saveVariables(list: Variable[]): void {
  const s = safeStorage();
  if (!s) return;
  try {
    s.setItem(VARIABLES_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // ignore quota errors
  }
}

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `var_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

export function coerceValue(type: VariableType, raw: string): VariableValue {
  switch (type) {
    case "number": {
      const n = Number(raw);
      return Number.isFinite(n) ? n : 0;
    }
    case "boolean":
      return raw === "true";
    case "json": {
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    case "string":
    default:
      return raw;
  }
}

export function valueToInputString(type: VariableType, value: VariableValue): string {
  if (type === "json") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return "";
    }
  }
  if (type === "boolean") {
    return value === true ? "true" : "false";
  }
  if (value === null || value === undefined) return "";
  return String(value);
}

export function upsertVariable(list: Variable[], input: VariableInput): Variable[] {
  const now = new Date().toISOString();
  if (input.id) {
    const existing = list.find((v) => v.id === input.id);
    if (existing) {
      const next: Variable = {
        ...existing,
        key: input.key,
        type: input.type,
        value: input.value,
        isSecret: input.isSecret,
        description: input.description,
        modifiedAt: now,
      };
      return list.map((v) => (v.id === input.id ? next : v));
    }
  }
  const created: Variable = {
    id: newId(),
    key: input.key,
    type: input.type,
    value: input.value,
    isSecret: input.isSecret,
    description: input.description,
    modifiedAt: now,
  };
  return [...list, created];
}

export function deleteVariable(list: Variable[], id: string): Variable[] {
  return list.filter((v) => v.id !== id);
}
