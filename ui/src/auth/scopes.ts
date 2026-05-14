// Copyright GraphCaster. All Rights Reserved.

import { useMemo, useSyncExternalStore } from "react";

export type Scope =
  | "workflow:read"
  | "workflow:write"
  | "credential:read"
  | "credential:write"
  | "user:read"
  | "user:invite"
  | "admin"
  | "project:read"
  | "project:write"
  | "source_control:read"
  | "source_control:write";

const KNOWN_SCOPES: ReadonlySet<string> = new Set<Scope>([
  "workflow:read",
  "workflow:write",
  "credential:read",
  "credential:write",
  "user:read",
  "user:invite",
  "admin",
  "project:read",
  "project:write",
  "source_control:read",
  "source_control:write",
]);

const STORAGE_KEY = "gc.user.scopes";

interface AuthStoreShape {
  getState?: () => { user?: { scopes?: ReadonlyArray<string> } | null } | undefined;
  subscribe?: (listener: () => void) => () => void;
}

function readAuthStoreScopes(): ReadonlyArray<string> | null {
  if (typeof globalThis === "undefined") {
    return null;
  }
  const g = globalThis as unknown as { useAuthStore?: AuthStoreShape };
  const store = g.useAuthStore;
  if (!store || typeof store.getState !== "function") {
    return null;
  }
  try {
    const state = store.getState();
    const scopes = state?.user?.scopes;
    if (Array.isArray(scopes)) {
      return scopes;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function readLocalStorageScopes(): ReadonlyArray<string> {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {
    /* ignore */
  }
  return [];
}

let cachedRaw: ReadonlyArray<string> = [];
let cachedKey = "";

function readRawScopesFresh(): ReadonlyArray<string> {
  const fromStore = readAuthStoreScopes();
  if (fromStore !== null) {
    return fromStore;
  }
  return readLocalStorageScopes();
}

function readRawScopes(): ReadonlyArray<string> {
  const fresh = readRawScopesFresh();
  const key = fresh.join("|");
  if (key !== cachedKey) {
    cachedKey = key;
    cachedRaw = fresh;
  }
  return cachedRaw;
}

function toScopeSet(raw: ReadonlyArray<string>): Set<Scope> {
  const out = new Set<Scope>();
  for (const item of raw) {
    if (KNOWN_SCOPES.has(item)) {
      out.add(item as Scope);
    }
  }
  return out;
}

export function getScopes(): Set<Scope> {
  return toScopeSet(readRawScopes());
}

export function hasScope(scopes: Set<Scope>, required: Scope | Scope[]): boolean {
  // Permissive default: if scopes have never been configured (empty set),
  // treat as unrestricted to avoid breaking flows where the auth store has
  // not yet been wired up.
  if (scopes.size === 0) {
    return true;
  }
  if (scopes.has("admin")) {
    return true;
  }
  const list = Array.isArray(required) ? required : [required];
  if (list.length === 0) {
    return true;
  }
  for (const r of list) {
    if (!scopes.has(r)) {
      return false;
    }
  }
  return true;
}

function subscribe(listener: () => void): () => void {
  const subs: Array<() => void> = [];
  if (typeof globalThis !== "undefined") {
    const g = globalThis as unknown as { useAuthStore?: AuthStoreShape };
    const store = g.useAuthStore;
    if (store && typeof store.subscribe === "function") {
      subs.push(store.subscribe(listener));
    }
  }
  if (typeof window !== "undefined") {
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === STORAGE_KEY || ev.key === null) {
        listener();
      }
    };
    window.addEventListener("storage", onStorage);
    subs.push(() => {
      window.removeEventListener("storage", onStorage);
    });
  }
  return () => {
    for (const s of subs) {
      try {
        s();
      } catch {
        /* ignore */
      }
    }
  };
}

function getServerSnapshot(): ReadonlyArray<string> {
  return [];
}

export function useScopes(): Set<Scope> {
  const raw = useSyncExternalStore(subscribe, readRawScopes, getServerSnapshot);
  return useMemo(() => toScopeSet(raw), [raw]);
}
