// Copyright GraphCaster. All Rights Reserved.

export type CredentialSummary = {
  id: string;
  name: string;
  type: string;
};

const LS_KEY = "gc.credentials";

function safeStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function readLocalCredentials(): CredentialSummary[] {
  const s = safeStorage();
  if (s == null) return [];
  try {
    const raw = s.getItem(LS_KEY);
    if (raw == null) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((v) => {
        if (v == null || typeof v !== "object") return null;
        const r = v as Record<string, unknown>;
        const id = typeof r.id === "string" ? r.id : null;
        const name = typeof r.name === "string" ? r.name : null;
        const type = typeof r.type === "string" ? r.type : null;
        if (id == null || name == null || type == null) return null;
        return { id, name, type };
      })
      .filter((v): v is CredentialSummary => v != null);
  } catch {
    return [];
  }
}

export type ListByTypeOptions = {
  fetcher?: typeof fetch;
  signal?: AbortSignal;
};

export const credentialsApi = {
  async listByType(type: string, options?: ListByTypeOptions): Promise<CredentialSummary[]> {
    if (typeof type !== "string" || type.trim() === "") return [];
    const fetcher: typeof fetch | null =
      options?.fetcher ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
    if (fetcher == null) {
      return readLocalCredentials().filter((c) => c.type === type);
    }
    try {
      const resp = await fetcher(
        `/api/v1/credentials?type=${encodeURIComponent(type)}`,
        { method: "GET", headers: { Accept: "application/json" }, signal: options?.signal },
      );
      if (!resp.ok) {
        return readLocalCredentials().filter((c) => c.type === type);
      }
      const body = (await resp.json()) as unknown;
      if (Array.isArray(body)) {
        return body
          .map((v) => {
            if (v == null || typeof v !== "object") return null;
            const r = v as Record<string, unknown>;
            const id = typeof r.id === "string" ? r.id : null;
            const name = typeof r.name === "string" ? r.name : null;
            const t = typeof r.type === "string" ? r.type : type;
            if (id == null || name == null) return null;
            return { id, name, type: t };
          })
          .filter((v): v is CredentialSummary => v != null);
      }
      return readLocalCredentials().filter((c) => c.type === type);
    } catch {
      return readLocalCredentials().filter((c) => c.type === type);
    }
  },
};

export const __test__ = { readLocalCredentials };
