// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Avatar,
  Button,
  Dialog,
  Icon,
  Input,
  Select,
  Text,
} from "../../components/ui";
import { useToast } from "../../toast/ToastProvider";

export type WorkflowShareRole = "viewer" | "editor";

export interface WorkflowSharedUser {
  userId: string;
  name?: string;
  email?: string;
  role: WorkflowShareRole;
}

export interface ShareModalProps {
  open: boolean;
  workflowId: string;
  workflowName?: string;
  onClose: () => void;
  loadShares?: (workflowId: string) => Promise<WorkflowSharedUser[]>;
  saveShare?: (workflowId: string, user: WorkflowSharedUser) => Promise<void>;
  removeShare?: (workflowId: string, userId: string) => Promise<void>;
}

function storageKey(id: string): string {
  return `gc.workflow.shares.${id}`;
}

function readStub(id: string): WorkflowSharedUser[] {
  try {
    const raw = localStorage.getItem(storageKey(id));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is WorkflowSharedUser =>
        item &&
        typeof item.userId === "string" &&
        (item.role === "viewer" || item.role === "editor"),
    );
  } catch {
    return [];
  }
}

function writeStub(id: string, users: WorkflowSharedUser[]): void {
  try {
    localStorage.setItem(storageKey(id), JSON.stringify(users));
  } catch {
    /* ignore */
  }
}

async function defaultLoadShares(id: string): Promise<WorkflowSharedUser[]> {
  try {
    const resp = await fetch(`/api/v1/workflows/${id}/shares`);
    if (resp.ok) {
      const json = (await resp.json()) as
        | { users?: WorkflowSharedUser[] }
        | WorkflowSharedUser[];
      if (Array.isArray(json)) return json;
      return json.users ?? [];
    }
  } catch {
    /* fall through */
  }
  return readStub(id);
}

async function defaultSaveShare(
  id: string,
  user: WorkflowSharedUser,
): Promise<void> {
  try {
    const resp = await fetch(`/api/v1/workflows/${id}/shares`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(user),
    });
    if (resp.ok) return;
  } catch {
    /* fall through */
  }
  const cur = readStub(id);
  writeStub(id, cur.filter((u) => u.userId !== user.userId).concat(user));
}

async function defaultRemoveShare(id: string, userId: string): Promise<void> {
  try {
    const resp = await fetch(
      `/api/v1/workflows/${id}/shares/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
    if (resp.ok || resp.status === 404) {
      const cur = readStub(id);
      writeStub(id, cur.filter((u) => u.userId !== userId));
      return;
    }
  } catch {
    /* fall through */
  }
  const cur = readStub(id);
  writeStub(id, cur.filter((u) => u.userId !== userId));
}

export function ShareModal({
  open,
  workflowId,
  workflowName,
  onClose,
  loadShares = defaultLoadShares,
  saveShare = defaultSaveShare,
  removeShare = defaultRemoveShare,
}: ShareModalProps) {
  const { t } = useTranslation();
  const toast = useToast();

  const [shared, setShared] = useState<WorkflowSharedUser[]>([]);
  const [inviteValue, setInviteValue] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkflowShareRole>("viewer");
  const [adding, setAdding] = useState(false);
  const [inputError, setInputError] = useState<string | undefined>();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    loadShares(workflowId)
      .then((users) => {
        if (!cancelled) setShared(users);
      })
      .catch(() => {
        if (!cancelled) setShared([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, workflowId, loadShares]);

  const roleOptions = useMemo(
    () => [
      { value: "viewer", label: t("workflowShare.roleViewer") },
      { value: "editor", label: t("workflowShare.roleEditor") },
    ],
    [t],
  );

  const handleAdd = useCallback(async () => {
    const trimmed = inviteValue.trim();
    if (!trimmed) {
      setInputError(t("workflowShare.addError"));
      return;
    }
    setInputError(undefined);
    setAdding(true);
    const isEmail = trimmed.includes("@");
    const user: WorkflowSharedUser = {
      userId: trimmed,
      email: isEmail ? trimmed : undefined,
      name: isEmail ? trimmed.split("@")[0] : trimmed,
      role: inviteRole,
    };
    try {
      await saveShare(workflowId, user);
      setShared((prev) => {
        const without = prev.filter((u) => u.userId !== user.userId);
        return [...without, user];
      });
      setInviteValue("");
      toast.push(t("workflowShare.addSuccess"), "success");
    } finally {
      setAdding(false);
    }
  }, [inviteValue, inviteRole, workflowId, saveShare, t, toast]);

  const handleRemove = useCallback(
    async (userId: string) => {
      await removeShare(workflowId, userId);
      setShared((prev) => prev.filter((u) => u.userId !== userId));
      toast.push(t("workflowShare.removeSuccess"), "success");
    },
    [workflowId, removeShare, t, toast],
  );

  const footer = (
    <div className="gc-workflow-share-modal__footer">
      <Button variant="solid" type="button" onClick={onClose}>
        {t("workflowShare.doneButton")}
      </Button>
    </div>
  );

  const title = workflowName
    ? t("workflowShare.modalTitleNamed", { name: workflowName })
    : t("workflowShare.modalTitle");

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      size="medium"
      title={title}
      footer={footer}
    >
      <div className="gc-workflow-share-modal" data-testid="workflow-share-modal">
        <section className="gc-workflow-share-modal__list">
          <Text size="sm" weight="medium">
            {t("workflowShare.currentListHeading")}
          </Text>
          {shared.length === 0 ? (
            <Text size="sm" color="secondary" data-testid="workflow-share-empty">
              {t("workflowShare.emptyShared")}
            </Text>
          ) : (
            <ul
              className="gc-workflow-share-modal__users"
              data-testid="workflow-share-list"
            >
              {shared.map((u) => (
                <li
                  key={u.userId}
                  className="gc-workflow-share-modal__user"
                  data-testid={`workflow-share-user-${u.userId}`}
                >
                  <Avatar fallback={u.name ?? u.email ?? u.userId} size="small" />
                  <div className="gc-workflow-share-modal__user-meta">
                    <span className="gc-workflow-share-modal__user-name">
                      {u.name ?? u.userId}
                    </span>
                    {u.email && (
                      <span className="gc-workflow-share-modal__user-email">
                        {u.email}
                      </span>
                    )}
                  </div>
                  <span className="gc-workflow-share-modal__user-role">
                    {u.role === "editor"
                      ? t("workflowShare.roleEditor")
                      : t("workflowShare.roleViewer")}
                  </span>
                  <button
                    type="button"
                    className="gc-workflow-share-modal__remove"
                    aria-label={t("workflowShare.removeAria", {
                      name: u.name ?? u.email ?? u.userId,
                    })}
                    onClick={() => handleRemove(u.userId)}
                    data-testid={`workflow-share-remove-${u.userId}`}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="gc-workflow-share-modal__invite">
          <Input
            value={inviteValue}
            onChange={(e) => setInviteValue(e.target.value)}
            placeholder={t("workflowShare.invitePlaceholder")}
            aria-label={t("workflowShare.invitePlaceholder")}
            data-testid="workflow-share-invite-input"
            variant={inputError ? "error" : "default"}
          />
          <Select
            value={inviteRole}
            onValueChange={(v) => setInviteRole(v as WorkflowShareRole)}
            options={roleOptions}
            aria-label={t("workflowShare.inviteRoleLabel")}
            data-testid="workflow-share-role-select"
          />
          <Button
            variant="solid"
            type="button"
            onClick={handleAdd}
            loading={adding}
            data-testid="workflow-share-add-btn"
          >
            {t("workflowShare.addButton")}
          </Button>
        </section>
        {inputError && (
          <Text size="xs" color="danger" data-testid="workflow-share-error">
            {inputError}
          </Text>
        )}
      </div>
    </Dialog>
  );
}
