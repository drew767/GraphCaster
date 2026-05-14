// Copyright GraphCaster. All Rights Reserved.

import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { type ColumnDef } from "@tanstack/react-table";

import {
  AlertDialog,
  Avatar,
  Badge,
  Button,
  DataTable,
  Dialog,
  InlineTextEdit,
  Input,
  Select,
  Switch,
  Tabs,
  Tag,
  Text,
} from "../../components/ui";
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MemberRole = "owner" | "admin" | "editor" | "viewer";

export interface TenantMembership {
  userId: string;
  name: string;
  email: string;
  avatarUrl?: string;
  role: MemberRole;
  invitedAt: string;
}

export interface ProjectWorkflow {
  id: string;
  name: string;
  active: boolean;
  updatedAt: string;
}

export interface ProjectCredential {
  id: string;
  name: string;
  type: string;
}

export interface ProjectVariable {
  key: string;
  value: string;
}

export interface ProjectDetail {
  id: string;
  name: string;
  description?: string;
  memberCount: number;
  createdAt: string;
  archived?: boolean;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchProject(id: string): Promise<ProjectDetail> {
  const resp = await fetch(`/api/v1/projects/${id}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json() as Promise<ProjectDetail>;
}

async function fetchMembers(projectId: string): Promise<TenantMembership[]> {
  const resp = await fetch(`/api/v1/projects/${projectId}/members`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json() as Promise<TenantMembership[]>;
}

async function fetchProjectWorkflows(projectId: string): Promise<ProjectWorkflow[]> {
  const resp = await fetch(`/api/v1/projects/${projectId}/workflows`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json() as Promise<ProjectWorkflow[]>;
}

async function fetchProjectCredentials(projectId: string): Promise<ProjectCredential[]> {
  const resp = await fetch(`/api/v1/projects/${projectId}/credentials`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json() as Promise<ProjectCredential[]>;
}

async function fetchProjectVariables(projectId: string): Promise<ProjectVariable[]> {
  const resp = await fetch(`/api/v1/projects/${projectId}/variables`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json() as Promise<ProjectVariable[]>;
}

async function inviteMember(projectId: string, email: string, role: MemberRole): Promise<void> {
  const resp = await fetch(`/api/v1/projects/${projectId}/members/invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, role }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

async function removeMember(projectId: string, userId: string): Promise<void> {
  const resp = await fetch(`/api/v1/projects/${projectId}/members/${userId}`, {
    method: "DELETE",
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

async function updateMemberRole(
  projectId: string,
  userId: string,
  role: MemberRole,
): Promise<void> {
  const resp = await fetch(`/api/v1/projects/${projectId}/members/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

async function moveWorkflowOut(
  projectId: string,
  workflowId: string,
): Promise<void> {
  const resp = await fetch(
    `/api/v1/projects/${projectId}/workflows/${workflowId}/move-out`,
    { method: "POST" },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

async function archiveProject(
  projectId: string,
  archived: boolean,
): Promise<void> {
  const resp = await fetch(`/api/v1/projects/${projectId}/archive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archived }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

async function updateProjectVariable(projectId: string, key: string, value: string): Promise<void> {
  const resp = await fetch(`/api/v1/projects/${projectId}/variables/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

async function updateProject(projectId: string, patch: { name?: string; description?: string }): Promise<void> {
  const resp = await fetch(`/api/v1/projects/${projectId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

async function deleteProject(projectId: string): Promise<void> {
  const resp = await fetch(`/api/v1/projects/${projectId}`, { method: "DELETE" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROLE_OPTIONS = [
  { value: "viewer", label: "Viewer" },
  { value: "editor", label: "Editor" },
  { value: "admin", label: "Admin" },
  { value: "owner", label: "Owner" },
];

const ROLE_VARIANT: Record<MemberRole, "neutral" | "success" | "primary" | "danger"> = {
  viewer: "neutral",
  editor: "primary",
  admin: "success",
  owner: "danger",
};

// ---------------------------------------------------------------------------
// InviteMemberModal
// ---------------------------------------------------------------------------

interface InviteMemberModalProps {
  open: boolean;
  onClose: () => void;
  onInvite: (email: string, role: MemberRole) => Promise<void>;
}

function InviteMemberModal({ open, onClose, onInvite }: InviteMemberModalProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("editor");
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setWorking(true);
    setErr(null);
    try {
      await onInvite(email, role);
      setEmail("");
      setRole("editor");
      onClose();
    } catch (error) {
      setErr(error instanceof Error ? error.message : t("app.projects.inviteError"));
    } finally {
      setWorking(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => { if (!v) onClose(); }}
      title={t("app.projects.inviteTitle")}
      size="small"
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="outline" size="small" onClick={onClose}>
            {t("app.projects.inviteCancel")}
          </Button>
          <Button variant="solid" size="small" loading={working} onClick={(e) => handleSubmit(e as unknown as React.FormEvent)}>
            {t("app.projects.inviteSubmit")}
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("app.projects.inviteEmailPlaceholder")}
          type="email"
          aria-label={t("app.projects.inviteEmail")}
        />
        <Select
          value={role}
          onValueChange={(v) => setRole(v as MemberRole)}
          options={ROLE_OPTIONS}
          aria-label={t("app.projects.inviteRole")}
        />
        {err && <Text size="small" color="danger">{err}</Text>}
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Members tab
// ---------------------------------------------------------------------------

interface MembersTabProps {
  projectId: string;
}

function MembersTab({ projectId }: MembersTabProps) {
  const { t } = useTranslation();
  const [members, setMembers] = useState<TenantMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<TenantMembership | null>(null);
  const [removeWorking, setRemoveWorking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMembers(projectId)
      .then((data) => { if (!cancelled) setMembers(data); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  async function handleInvite(email: string, role: MemberRole) {
    await inviteMember(projectId, email, role);
    const data = await fetchMembers(projectId);
    setMembers(data);
  }

  async function handleRemoveConfirm() {
    if (!removeTarget) return;
    setRemoveWorking(true);
    try {
      await removeMember(projectId, removeTarget.userId);
      setMembers((prev) => prev.filter((m) => m.userId !== removeTarget.userId));
      setRemoveTarget(null);
    } finally {
      setRemoveWorking(false);
    }
  }

  async function handleRoleChange(userId: string, role: MemberRole) {
    setMembers((prev) =>
      prev.map((m) => (m.userId === userId ? { ...m, role } : m)),
    );
    try {
      await updateMemberRole(projectId, userId, role);
    } catch {
      // optimistic update; refetch to recover
      const data = await fetchMembers(projectId);
      setMembers(data);
    }
  }

  const columns: ColumnDef<TenantMembership>[] = [
    {
      id: "member",
      header: t("app.projects.members.columns.member"),
      cell: ({ row }) => (
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Avatar src={row.original.avatarUrl} fallback={row.original.name} size="xsmall" />
          <span>
            <span style={{ display: "block" }}>{row.original.name}</span>
            <span style={{ fontSize: 11, color: "var(--gc-text-muted)" }}>{row.original.email}</span>
          </span>
        </span>
      ),
    },
    {
      id: "role",
      header: t("app.projects.members.columns.role"),
      cell: ({ row }) => (
        row.original.role === "owner" ? (
          <Badge text={row.original.role} variant={ROLE_VARIANT[row.original.role]} size="small" />
        ) : (
          <Select<MemberRole>
            value={row.original.role}
            onValueChange={(v) => { void handleRoleChange(row.original.userId, v); }}
            options={ROLE_OPTIONS.filter((o) => o.value !== "owner") as Array<{ value: MemberRole; label: string }>}
            size="small"
            aria-label={t("app.projects.members.changeRole")}
            data-testid={`member-role-${row.original.userId}`}
          />
        )
      ),
    },
    {
      id: "invitedAt",
      header: t("app.projects.members.columns.invitedAt"),
      cell: ({ row }) => (
        <Text size="small">{new Date(row.original.invitedAt).toLocaleDateString()}</Text>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        row.original.role === "owner" ? null : (
          <Button
            variant="ghost"
            size="xsmall"
            iconLeft="trash-2"
            onClick={() => setRemoveTarget(row.original)}
            aria-label={t("app.projects.members.remove")}
            data-testid={`member-remove-${row.original.userId}`}
          />
        )
      ),
      size: 48,
      enableSorting: false,
    },
  ];

  return (
    <div data-testid="members-tab">
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <Button variant="solid" size="small" iconLeft="user-pen" onClick={() => setInviteOpen(true)}>
          {t("app.projects.members.invite")}
        </Button>
      </div>

      <DataTable
        data={members}
        columns={columns}
        loading={loading}
        size="small"
        striped
        emptyState={<Text color="subtle">{t("app.projects.members.empty")}</Text>}
      />

      <InviteMemberModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInvite={handleInvite}
      />

      <AlertDialog
        open={removeTarget !== null}
        onOpenChange={(v) => { if (!v) setRemoveTarget(null); }}
        title={t("app.projects.members.removeTitle")}
        description={t("app.projects.members.removeDescription", { name: removeTarget?.name ?? "" })}
        confirmLabel={t("app.projects.members.removeConfirm")}
        cancelLabel={t("app.projects.members.removeCancel")}
        destructive
        onConfirm={handleRemoveConfirm}
        loading={removeWorking}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workflows tab
// ---------------------------------------------------------------------------

interface WorkflowsTabProps {
  projectId: string;
}

function WorkflowsTab({ projectId }: WorkflowsTabProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<ProjectWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [moveTarget, setMoveTarget] = useState<ProjectWorkflow | null>(null);
  const [moveWorking, setMoveWorking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchProjectWorkflows(projectId)
      .then((data) => { if (!cancelled) setWorkflows(data); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  async function handleMoveConfirm() {
    if (!moveTarget) return;
    setMoveWorking(true);
    try {
      await moveWorkflowOut(projectId, moveTarget.id);
      setWorkflows((prev) => prev.filter((w) => w.id !== moveTarget.id));
      setMoveTarget(null);
    } finally {
      setMoveWorking(false);
    }
  }

  const columns: ColumnDef<ProjectWorkflow>[] = [
    {
      id: "name",
      header: t("app.projects.workflows.columns.name"),
      cell: ({ row }) => (
        <button
          type="button"
          className="gc-link"
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--gc-text-accent)", padding: 0 }}
          onClick={() => navigate(`/workflow/${row.original.id}`)}
        >
          {row.original.name}
        </button>
      ),
    },
    {
      id: "active",
      header: t("app.projects.workflows.columns.active"),
      cell: ({ row }) => (
        <Tag variant={row.original.active ? "success" : "default"} size="small">
          {row.original.active ? t("app.projects.workflows.active") : t("app.projects.workflows.inactive")}
        </Tag>
      ),
    },
    {
      id: "updatedAt",
      header: t("app.projects.workflows.columns.updatedAt"),
      cell: ({ row }) => (
        <Text size="small">{new Date(row.original.updatedAt).toLocaleDateString()}</Text>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="xsmall"
          iconLeft="log-out"
          onClick={() => setMoveTarget(row.original)}
          aria-label={t("app.projects.workflows.moveOut")}
          data-testid={`workflow-move-out-${row.original.id}`}
        >
          {t("app.projects.workflows.moveOut")}
        </Button>
      ),
      size: 120,
      enableSorting: false,
    },
  ];

  return (
    <div data-testid="workflows-tab">
      <DataTable
        data={workflows}
        columns={columns}
        loading={loading}
        size="small"
        striped
        emptyState={<Text color="subtle">{t("app.projects.workflows.empty")}</Text>}
      />

      <AlertDialog
        open={moveTarget !== null}
        onOpenChange={(v) => { if (!v) setMoveTarget(null); }}
        title={t("app.projects.workflows.moveOutTitle")}
        description={t("app.projects.workflows.moveOutDescription", { name: moveTarget?.name ?? "" })}
        confirmLabel={t("app.projects.workflows.moveOutConfirm")}
        cancelLabel={t("app.projects.workflows.moveOutCancel")}
        onConfirm={handleMoveConfirm}
        loading={moveWorking}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Credentials tab
// ---------------------------------------------------------------------------

interface CredentialsTabProps {
  projectId: string;
}

function CredentialsTab({ projectId }: CredentialsTabProps) {
  const { t } = useTranslation();
  const [credentials, setCredentials] = useState<ProjectCredential[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchProjectCredentials(projectId)
      .then((data) => { if (!cancelled) setCredentials(data); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  const columns: ColumnDef<ProjectCredential>[] = [
    {
      id: "name",
      header: t("app.projects.credentials.columns.name"),
      accessorKey: "name",
    },
    {
      id: "type",
      header: t("app.projects.credentials.columns.type"),
      cell: ({ row }) => (
        <Tag variant="default" size="small">{row.original.type}</Tag>
      ),
    },
  ];

  return (
    <div data-testid="credentials-tab">
      <DataTable
        data={credentials}
        columns={columns}
        loading={loading}
        size="small"
        striped
        emptyState={<Text color="subtle">{t("app.projects.credentials.empty")}</Text>}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variables tab
// ---------------------------------------------------------------------------

interface VariablesTabProps {
  projectId: string;
}

function VariablesTab({ projectId }: VariablesTabProps) {
  const { t } = useTranslation();
  const [variables, setVariables] = useState<ProjectVariable[]>([]);
  const [loading, setLoading] = useState(true);
  const [editTarget, setEditTarget] = useState<ProjectVariable | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editWorking, setEditWorking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchProjectVariables(projectId)
      .then((data) => { if (!cancelled) setVariables(data); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  function openEdit(v: ProjectVariable) {
    setEditTarget(v);
    setEditValue(v.value);
  }

  async function handleSave() {
    if (!editTarget) return;
    setEditWorking(true);
    try {
      await updateProjectVariable(projectId, editTarget.key, editValue);
      setVariables((prev) =>
        prev.map((v) => (v.key === editTarget.key ? { ...v, value: editValue } : v)),
      );
      setEditTarget(null);
    } finally {
      setEditWorking(false);
    }
  }

  const columns: ColumnDef<ProjectVariable>[] = [
    {
      id: "key",
      header: t("app.projects.variables.columns.key"),
      accessorKey: "key",
      cell: ({ row }) => <code style={{ fontSize: 12 }}>{row.original.key}</code>,
    },
    {
      id: "value",
      header: t("app.projects.variables.columns.value"),
      accessorKey: "value",
      cell: ({ row }) => (
        <span style={{ fontSize: 12, fontFamily: "monospace" }}>{row.original.value}</span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="xsmall"
          iconLeft="pencil"
          onClick={() => openEdit(row.original)}
          aria-label={t("app.projects.variables.edit")}
        />
      ),
      size: 48,
      enableSorting: false,
    },
  ];

  return (
    <div data-testid="variables-tab">
      <DataTable
        data={variables}
        columns={columns}
        loading={loading}
        size="small"
        striped
        emptyState={<Text color="subtle">{t("app.projects.variables.empty")}</Text>}
      />

      <Dialog
        open={editTarget !== null}
        onOpenChange={(v) => { if (!v) setEditTarget(null); }}
        title={t("app.projects.variables.editTitle")}
        size="small"
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="outline" size="small" onClick={() => setEditTarget(null)}>
              {t("app.projects.variables.editCancel")}
            </Button>
            <Button variant="solid" size="small" loading={editWorking} onClick={handleSave}>
              {t("app.projects.variables.editSave")}
            </Button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Text size="small" color="subtle">
            {t("app.projects.variables.editKey")}: <code>{editTarget?.key}</code>
          </Text>
          <Input
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            placeholder={t("app.projects.variables.editValuePlaceholder")}
            aria-label={t("app.projects.variables.editValue")}
          />
        </div>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

interface SettingsTabProps {
  project: ProjectDetail;
  onUpdated: (patch: { name?: string; description?: string }) => void;
  onDeleted: () => void;
}

function SettingsTab({ project, onUpdated, onDeleted }: SettingsTabProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [archived, setArchived] = useState(Boolean(project.archived));
  const [archiveWorking, setArchiveWorking] = useState(false);
  const [saveWorking, setSaveWorking] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteFinalOpen, setDeleteFinalOpen] = useState(false);
  const [deleteWorking, setDeleteWorking] = useState(false);

  async function handleSave() {
    setSaveWorking(true);
    try {
      await updateProject(project.id, { name, description });
      onUpdated({ name, description });
    } finally {
      setSaveWorking(false);
    }
  }

  async function handleArchiveToggle(next: boolean) {
    setArchiveWorking(true);
    setArchived(next);
    try {
      await archiveProject(project.id, next);
    } catch {
      setArchived(!next);
    } finally {
      setArchiveWorking(false);
    }
  }

  async function handleDelete() {
    setDeleteWorking(true);
    try {
      await deleteProject(project.id);
      onDeleted();
    } finally {
      setDeleteWorking(false);
    }
  }

  function handleFirstConfirm() {
    if (deleteConfirmText.trim() === project.name) {
      setDeleteOpen(false);
      setDeleteFinalOpen(true);
    }
  }

  return (
    <div data-testid="project-settings-tab" style={{ maxWidth: 520, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Text size="small" weight="medium" style={{ marginBottom: 4 }}>{t("app.projects.settings.name")}</Text>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("app.projects.settings.namePlaceholder")}
          aria-label={t("app.projects.settings.name")}
          data-testid="settings-name-input"
        />
      </div>
      <div>
        <Text size="small" weight="medium" style={{ marginBottom: 4 }}>{t("app.projects.settings.description")}</Text>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("app.projects.settings.descriptionPlaceholder")}
          aria-label={t("app.projects.settings.description")}
          data-testid="settings-description-input"
        />
      </div>
      <Button variant="solid" size="small" loading={saveWorking} onClick={handleSave} data-testid="settings-save-btn">
        {t("app.projects.settings.save")}
      </Button>

      <div
        className="gc-archive-zone"
        style={{ marginTop: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
        data-testid="settings-archive-row"
      >
        <div>
          <Text size="small" weight="medium">{t("app.projects.settings.archiveLabel")}</Text>
          <Text size="small" color="subtle">{t("app.projects.settings.archiveHint")}</Text>
        </div>
        <Switch
          checked={archived}
          onCheckedChange={(v) => { void handleArchiveToggle(v); }}
          disabled={archiveWorking}
          data-testid="settings-archive-toggle"
        />
      </div>

      <div className="gc-danger-zone" style={{ marginTop: 24, borderTop: "1px solid var(--gc-border-danger, #f87171)", paddingTop: 16 }}>
        <Text size="small" weight="medium" color="danger">{t("app.projects.settings.dangerZone")}</Text>
        <Text size="small" color="subtle" style={{ marginTop: 4 }}>{t("app.projects.settings.deleteHint")}</Text>
        <Button
          variant="destructive"
          size="small"
          iconLeft="trash-2"
          className="gc-danger-zone__delete-btn"
          onClick={() => { setDeleteConfirmText(""); setDeleteOpen(true); }}
        >
          {t("app.projects.settings.deleteButton")}
        </Button>
      </div>

      <Dialog
        open={deleteOpen}
        onOpenChange={(v) => { if (!v) setDeleteOpen(false); }}
        title={t("app.projects.deleteTitle")}
        size="small"
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="outline" size="small" onClick={() => setDeleteOpen(false)}>
              {t("app.projects.deleteCancel")}
            </Button>
            <Button
              variant="destructive"
              size="small"
              disabled={deleteConfirmText.trim() !== project.name}
              onClick={handleFirstConfirm}
              data-testid="settings-delete-first-confirm"
            >
              {t("app.projects.settings.deleteContinue")}
            </Button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Text size="small">
            {t("app.projects.settings.deleteTypeName", { name: project.name })}
          </Text>
          <Input
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder={project.name}
            aria-label={t("app.projects.settings.deleteTypeNameAria")}
            data-testid="settings-delete-confirm-input"
          />
        </div>
      </Dialog>

      <AlertDialog
        open={deleteFinalOpen}
        onOpenChange={(v) => { if (!v) setDeleteFinalOpen(false); }}
        title={t("app.projects.settings.deleteFinalTitle")}
        description={t("app.projects.deleteDescription", { name: project.name })}
        confirmLabel={t("app.projects.deleteConfirm")}
        cancelLabel={t("app.projects.deleteCancel")}
        destructive
        onConfirm={handleDelete}
        loading={deleteWorking}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ProjectDetails() {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    fetchProject(projectId)
      .then((data) => { if (!cancelled) setProject(data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : t("app.projects.loadError")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, t]);

  const handleUpdated = useCallback((patch: { name?: string; description?: string }) => {
    setProject((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const handleDeleted = useCallback(() => {
    navigate("/projects");
  }, [navigate]);

  const projectIdSafe = project?.id;
  const projectNameSafe = project?.name ?? "";
  const projectDescSafe = project?.description ?? "";

  const handleInlineRenameName = useCallback(
    async (next: string) => {
      const trimmed = next.trim();
      if (!projectIdSafe || !trimmed || trimmed === projectNameSafe) return;
      setProject((prev) => (prev ? { ...prev, name: trimmed } : prev));
      try {
        await updateProject(projectIdSafe, { name: trimmed });
      } catch {
        setProject((prev) => (prev ? { ...prev, name: projectNameSafe } : prev));
      }
    },
    [projectIdSafe, projectNameSafe],
  );

  const handleInlineRenameDescription = useCallback(
    async (next: string) => {
      if (!projectIdSafe || next === projectDescSafe) return;
      setProject((prev) => (prev ? { ...prev, description: next } : prev));
      try {
        await updateProject(projectIdSafe, { description: next });
      } catch {
        setProject((prev) => (prev ? { ...prev, description: projectDescSafe } : prev));
      }
    },
    [projectIdSafe, projectDescSafe],
  );

  if (loading) {
    return (
      <div data-testid="project-details-loading" style={{ padding: 24 }}>
        <Text color="subtle">{t("app.projects.loading")}</Text>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div role="alert" style={{ padding: 24 }}>
        <Text color="danger">{error ?? t("app.projects.notFound")}</Text>
      </div>
    );
  }

  const tabs = [
    {
      id: "members",
      label: t("app.projects.tabs.members"),
      icon: "users" as const,
      badge: <Badge count={project.memberCount} variant="neutral" size="small" />,
      content: <MembersTab projectId={project.id} />,
    },
    {
      id: "workflows",
      label: t("app.projects.tabs.workflows"),
      icon: "git-branch" as const,
      content: <WorkflowsTab projectId={project.id} />,
    },
    {
      id: "credentials",
      label: t("app.projects.tabs.credentials"),
      icon: "key-round" as const,
      content: <CredentialsTab projectId={project.id} />,
    },
    {
      id: "variables",
      label: t("app.projects.tabs.variables"),
      icon: "variable" as const,
      content: <VariablesTab projectId={project.id} />,
    },
    {
      id: "settings",
      label: t("app.projects.tabs.settings"),
      icon: "settings" as const,
      content: (
        <SettingsTab
          project={project}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
        />
      ),
    },
  ];

  return (
    <div className="gc-project-details" data-testid="project-details-page">
      <div className="gc-project-details__header" style={{ marginBottom: 16 }}>
        <Button
          variant="ghost"
          size="small"
          iconLeft="chevron-left"
          onClick={() => navigate("/projects")}
        >
          {t("app.projects.backToProjects")}
        </Button>
        <div style={{ marginTop: 8 }} data-testid="project-name-inline-edit">
          <InlineTextEdit
            value={project.name}
            onChange={(v) => { void handleInlineRenameName(v); }}
            size="large"
            placeholder={t("app.projects.settings.namePlaceholder")}
            validate={(v) => (v.trim() ? undefined : t("app.projects.nameRequired"))}
          />
        </div>
        <div style={{ marginTop: 4 }} data-testid="project-description-inline-edit">
          <InlineTextEdit
            value={project.description ?? ""}
            onChange={(v) => { void handleInlineRenameDescription(v); }}
            size="small"
            placeholder={t("app.projects.settings.descriptionPlaceholder")}
          />
        </div>
      </div>

      <Tabs items={tabs} defaultValue="members" lazyMount />
    </div>
  );
}
