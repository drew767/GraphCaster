// Copyright GraphCaster. All Rights Reserved.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Avatar,
  Button,
  Dialog,
  Icon,
  Input,
  Select,
} from "../../components/ui";
import { useToast } from "../../toast/ToastProvider";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ShareRole = "viewer" | "editor";

export interface SharedUser {
  userId: string;
  name?: string;
  email?: string;
  role: ShareRole;
}

interface CredentialShareModalProps {
  open: boolean;
  credentialId: string;
  credentialName: string;
  onClose: () => void;
  loadShares?: (credentialId: string) => Promise<SharedUser[]>;
  saveShare?: (credentialId: string, user: SharedUser) => Promise<void>;
  removeShare?: (credentialId: string, userId: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// localStorage stub helpers
// ---------------------------------------------------------------------------

function storageKey(credId: string): string {
  return `gc.credential.shares.${credId}`;
}

function readStubShares(credId: string): SharedUser[] {
  try {
    const raw = localStorage.getItem(storageKey(credId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SharedUser =>
        item && typeof item.userId === "string" && (item.role === "viewer" || item.role === "editor"),
    );
  } catch {
    return [];
  }
}

function writeStubShares(credId: string, users: SharedUser[]): void {
  try {
    localStorage.setItem(storageKey(credId), JSON.stringify(users));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Default API adapters (with localStorage fallback)
// ---------------------------------------------------------------------------

async function defaultLoadShares(credId: string): Promise<SharedUser[]> {
  try {
    const resp = await fetch(`/api/v1/credentials/${credId}/shares`);
    if (resp.ok) {
      const json = (await resp.json()) as { users?: SharedUser[] } | SharedUser[];
      if (Array.isArray(json)) return json;
      return json.users ?? [];
    }
  } catch {
    /* fall through */
  }
  return readStubShares(credId);
}

async function defaultSaveShare(credId: string, user: SharedUser): Promise<void> {
  try {
    const resp = await fetch(`/api/v1/credentials/${credId}/shares`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(user),
    });
    if (resp.ok) return;
  } catch {
    /* fall through */
  }
  const current = readStubShares(credId);
  const next = current.filter((u) => u.userId !== user.userId).concat(user);
  writeStubShares(credId, next);
}

async function defaultRemoveShare(credId: string, userId: string): Promise<void> {
  try {
    const resp = await fetch(
      `/api/v1/credentials/${credId}/shares/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
    if (resp.ok || resp.status === 404) {
      const cur = readStubShares(credId);
      writeStubShares(credId, cur.filter((u) => u.userId !== userId));
      return;
    }
  } catch {
    /* fall through */
  }
  const current = readStubShares(credId);
  writeStubShares(credId, current.filter((u) => u.userId !== userId));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CredentialShareModal({
  open,
  credentialId,
  credentialName,
  onClose,
  loadShares = defaultLoadShares,
  saveShare = defaultSaveShare,
  removeShare = defaultRemoveShare,
}: CredentialShareModalProps) {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [shared, setShared] = useState<SharedUser[]>([]);
  const [inviteValue, setInviteValue] = useState("");
  const [inviteRole, setInviteRole] = useState<ShareRole>("viewer");
  const [adding, setAdding] = useState(false);
  const [inputError, setInputError] = useState<string | undefined>();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    loadShares(credentialId)
      .then((users) => {
        if (!cancelled) setShared(users);
      })
      .catch(() => {
        if (!cancelled) setShared([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, credentialId, loadShares]);

  const roleOptions = useMemo(
    () => [
      { value: "viewer", label: t("credentials.share.roleViewer") },
      { value: "editor", label: t("credentials.share.roleEditor") },
    ],
    [t],
  );

  const handleAdd = useCallback(async () => {
    const trimmed = inviteValue.trim();
    if (!trimmed) {
      setInputError(t("credentials.share.addError"));
      return;
    }
    setInputError(undefined);
    setAdding(true);
    const isEmail = trimmed.includes("@");
    const user: SharedUser = {
      userId: trimmed,
      email: isEmail ? trimmed : undefined,
      name: isEmail ? trimmed.split("@")[0] : trimmed,
      role: inviteRole,
    };
    try {
      await saveShare(credentialId, user);
      setShared((prev) => {
        const without = prev.filter((u) => u.userId !== user.userId);
        return [...without, user];
      });
      setInviteValue("");
      toast.success(t("credentials.share.addSuccess"));
    } finally {
      setAdding(false);
    }
  }, [inviteValue, inviteRole, credentialId, saveShare, t, toast]);

  const handleRemove = useCallback(
    async (userId: string) => {
      await removeShare(credentialId, userId);
      setShared((prev) => prev.filter((u) => u.userId !== userId));
      toast.success(t("credentials.share.removeSuccess"));
    },
    [credentialId, removeShare, t, toast],
  );

  const footer = (
    <div className="gc-cred-share-modal__footer">
      <Button variant="solid" type="button" onClick={onClose}>
        {t("credentials.share.doneButton")}
      </Button>
    </div>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      size="medium"
      title={t("credentials.share.modalTitle", { name: credentialName })}
      footer={footer}
    >
      <div className="gc-cred-share-modal" data-testid="credential-share-modal">
        <section className="gc-cred-share-modal__list">
          <h3 className="gc-cred-share-modal__list-heading">
            {t("credentials.share.currentListHeading")}
          </h3>
          {shared.length === 0 ? (
            <p
              className="gc-cred-share-modal__muted"
              data-testid="credential-share-empty"
            >
              {t("credentials.share.emptyShared")}
            </p>
          ) : (
            <ul className="gc-cred-share-modal__users" data-testid="credential-share-list">
              {shared.map((u) => (
                <li
                  key={u.userId}
                  className="gc-cred-share-modal__user"
                  data-testid={`credential-share-user-${u.userId}`}
                >
                  <Avatar fallback={u.name ?? u.email ?? u.userId} size="small" />
                  <div className="gc-cred-share-modal__user-meta">
                    <span className="gc-cred-share-modal__user-name">
                      {u.name ?? u.userId}
                    </span>
                    {u.email && (
                      <span className="gc-cred-share-modal__user-email">{u.email}</span>
                    )}
                  </div>
                  <span className="gc-cred-share-modal__user-role">
                    {u.role === "editor"
                      ? t("credentials.share.roleEditor")
                      : t("credentials.share.roleViewer")}
                  </span>
                  <button
                    type="button"
                    className="gc-cred-share-modal__remove"
                    aria-label={t("credentials.share.removeAria", {
                      name: u.name ?? u.email ?? u.userId,
                    })}
                    onClick={() => handleRemove(u.userId)}
                    data-testid={`credential-share-remove-${u.userId}`}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="gc-cred-share-modal__invite">
          <Input
            value={inviteValue}
            onChange={(e) => setInviteValue(e.target.value)}
            placeholder={t("credentials.share.invitePlaceholder")}
            aria-label={t("credentials.share.invitePlaceholder")}
            data-testid="credential-share-invite-input"
            variant={inputError ? "error" : "default"}
          />
          <Select
            value={inviteRole}
            onValueChange={(v) => setInviteRole(v as ShareRole)}
            options={roleOptions}
            aria-label={t("credentials.share.inviteRoleLabel")}
            data-testid="credential-share-role-select"
          />
          <Button
            variant="solid"
            type="button"
            onClick={handleAdd}
            loading={adding}
            data-testid="credential-share-add-btn"
          >
            {t("credentials.share.addButton")}
          </Button>
        </section>
        {inputError && (
          <p
            className="gc-cred-share-modal__error"
            data-testid="credential-share-error"
          >
            {inputError}
          </p>
        )}
      </div>
    </Dialog>
  );
}
