// Copyright GraphCaster. All Rights Reserved.

import type { UserRole } from "./Users";

export const PENDING_INVITATIONS_STORAGE_KEY = "gc.pending_invitations";

export interface PendingInvitation {
  id: string;
  email: string;
  role: UserRole;
  invitedAt: string;
  invitedBy?: string;
}

export interface PendingInvitationsApi {
  list: () => Promise<PendingInvitation[]>;
  resend: (id: string) => Promise<void>;
  revoke: (id: string) => Promise<void>;
  add: (invitation: Omit<PendingInvitation, "id" | "invitedAt"> & { id?: string; invitedAt?: string }) => PendingInvitation;
}

function safeRead(): PendingInvitation[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(PENDING_INVITATIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is PendingInvitation =>
        !!v &&
        typeof v === "object" &&
        typeof (v as PendingInvitation).id === "string" &&
        typeof (v as PendingInvitation).email === "string" &&
        typeof (v as PendingInvitation).role === "string" &&
        typeof (v as PendingInvitation).invitedAt === "string",
    );
  } catch {
    return [];
  }
}

function safeWrite(list: PendingInvitation[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(PENDING_INVITATIONS_STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

async function tryRemoteList(): Promise<PendingInvitation[] | null> {
  try {
    const resp = await fetch("/api/v1/users/invitations");
    if (resp.status === 404) return null;
    if (!resp.ok) return null;
    const data = (await resp.json()) as { invitations?: PendingInvitation[] } | PendingInvitation[];
    if (Array.isArray(data)) return data;
    if (data && Array.isArray((data as { invitations?: PendingInvitation[] }).invitations)) {
      return (data as { invitations: PendingInvitation[] }).invitations;
    }
    return null;
  } catch {
    return null;
  }
}

export const pendingInvitationsApi: PendingInvitationsApi = {
  async list() {
    const remote = await tryRemoteList();
    if (remote) return remote;
    return safeRead();
  },
  async resend(_id: string) {
    // No-op in mock backend. In a real backend this would POST /resend.
    return Promise.resolve();
  },
  async revoke(id: string) {
    const list = safeRead().filter((i) => i.id !== id);
    safeWrite(list);
    return Promise.resolve();
  },
  add(invitation) {
    const id =
      invitation.id ??
      (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `inv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const invitedAt = invitation.invitedAt ?? new Date().toISOString();
    const newInv: PendingInvitation = {
      id,
      email: invitation.email,
      role: invitation.role,
      invitedAt,
      invitedBy: invitation.invitedBy,
    };
    const list = safeRead();
    list.unshift(newInv);
    safeWrite(list);
    return newInv;
  },
};

export function formatInvitedAgo(iso: string, now: number = Date.now()): {
  unit: "justNow" | "minutes" | "hours" | "days";
  value: number;
} {
  const diff = now - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return { unit: "justNow", value: 0 };
  if (minutes < 60) return { unit: "minutes", value: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: "hours", value: hours };
  const days = Math.floor(hours / 24);
  return { unit: "days", value: days };
}
