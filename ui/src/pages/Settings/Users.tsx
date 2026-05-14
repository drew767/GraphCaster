// Copyright GraphCaster. All Rights Reserved.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";

import {
  AlertDialog,
  Avatar,
  Button,
  DataTableServer,
  DropdownMenu,
  Heading,
  Input,
  Select,
  Tag,
  Text,
} from "../../components/ui";
import type { TagProps } from "../../components/ui";
import type { DropdownItem } from "../../components/ui";
import { useUIStore } from "../../app/stores/uiStore";
import { useToast } from "../../toast/ToastProvider";
import { InviteUsersModal, INVITE_USERS_MODAL_KEY } from "./InviteUsersModal";
import {
  pendingInvitationsApi,
  formatInvitedAgo,
  type PendingInvitation,
} from "./pendingInvitations";

const PENDING_INVITATIONS_CHANGED_EVENT = "gc:pending-invitations-changed";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UserRole =
  | "owner"
  | "admin"
  | "editor"
  | "viewer"
  | "dataset_operator";

export interface TeamUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  lastActive?: string;
  projectCount?: number;
  avatarUrl?: string;
  isPending?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fullName(u: TeamUser): string {
  return [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email;
}

const ROLE_VARIANT: Record<UserRole, TagProps["variant"]> = {
  owner: "danger",
  admin: "warning",
  editor: "primary",
  viewer: "default",
  dataset_operator: "info",
};

function formatRelative(iso?: string): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchUsers(params: {
  search: string;
  role: string;
  page: number;
  pageSize: number;
}): Promise<{ users: TeamUser[]; total: number }> {
  const qs = new URLSearchParams({
    search: params.search,
    role: params.role,
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  const resp = await fetch(`/api/v1/users?${qs.toString()}`);
  if (resp.status === 404) throw Object.assign(new Error("not_found"), { status: 404 });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json() as Promise<{ users: TeamUser[]; total: number }>;
}

async function patchUserRole(userId: string, role: UserRole): Promise<void> {
  const resp = await fetch(`/api/v1/users/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

async function deleteUser(userId: string): Promise<void> {
  const resp = await fetch(`/api/v1/users/${userId}`, { method: "DELETE" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

async function resetPassword(userId: string): Promise<void> {
  const resp = await fetch(`/api/v1/users/${userId}/reset-password`, {
    method: "POST",
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

async function generateInviteLink(userId: string): Promise<string> {
  const resp = await fetch(`/api/v1/users/${userId}/invite-link`, {
    method: "POST",
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = (await resp.json()) as { link: string };
  return data.link;
}

// ---------------------------------------------------------------------------
// Debounce hook
// ---------------------------------------------------------------------------

function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// ---------------------------------------------------------------------------
// Role label map
// ---------------------------------------------------------------------------

const ALL_ROLES: UserRole[] = ["owner", "admin", "editor", "viewer", "dataset_operator"];

function useRoleLabel() {
  const { t } = useTranslation();
  return (role: UserRole) => t(`app.settings.users.roles.${role}`);
}

// ---------------------------------------------------------------------------
// Users page
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

export default function UsersPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const openModal = useUIStore((s) => s.openModal);
  const roleLabel = useRoleLabel();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search);
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [page, setPage] = useState(0);

  const [users, setUsers] = useState<TeamUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<TeamUser | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([]);
  const [revokeTarget, setRevokeTarget] = useState<PendingInvitation | null>(null);

  const loadRef = useRef(0);

  const loadPending = useCallback(() => {
    void pendingInvitationsApi.list().then((list) => {
      setPendingInvitations(list);
    });
  }, []);

  useEffect(() => {
    loadPending();
    const handler = () => loadPending();
    if (typeof window !== "undefined") {
      window.addEventListener(PENDING_INVITATIONS_CHANGED_EVENT, handler);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener(PENDING_INVITATIONS_CHANGED_EVENT, handler);
      }
    };
  }, [loadPending]);

  const handleResendInvitation = useCallback(
    async (inv: PendingInvitation) => {
      try {
        await pendingInvitationsApi.resend(inv.id);
        toast.success(t("app.settings.users.pendingInvitations.resentToast", { email: inv.email }));
      } catch {
        toast.error(t("app.settings.users.pendingInvitations.resendError"));
      }
    },
    [t, toast],
  );

  const handleRevokeInvitation = useCallback(async () => {
    if (!revokeTarget) return;
    try {
      await pendingInvitationsApi.revoke(revokeTarget.id);
      toast.success(t("app.settings.users.pendingInvitations.revokedToast", { email: revokeTarget.email }));
      setRevokeTarget(null);
      loadPending();
    } catch {
      toast.error(t("app.settings.users.pendingInvitations.revokeError"));
    }
  }, [revokeTarget, loadPending, t, toast]);

  function formatPendingAgo(iso: string): string {
    const { unit, value } = formatInvitedAgo(iso);
    if (unit === "justNow") return t("app.settings.users.pendingInvitations.justNow");
    return t(`app.settings.users.pendingInvitations.ago.${unit}`, { count: value });
  }

  const load = useCallback(() => {
    const seq = ++loadRef.current;
    setLoading(true);
    fetchUsers({
      search: debouncedSearch,
      role: roleFilter === "all" ? "" : roleFilter,
      page,
      pageSize: PAGE_SIZE,
    })
      .then(({ users: u, total: t }) => {
        if (seq !== loadRef.current) return;
        setUsers(u);
        setTotal(t);
      })
      .catch((err: Error & { status?: number }) => {
        if (seq !== loadRef.current) return;
        setUsers([]);
        setTotal(0);
        if (err.status === 404) {
          toast.warning(t("app.settings.users.endpointNotFound"));
        } else {
          toast.error(t("app.settings.users.loadError"));
        }
      })
      .finally(() => {
        if (seq === loadRef.current) setLoading(false);
      });
  }, [debouncedSearch, roleFilter, page, t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, roleFilter]);

  const handleRoleChange = useCallback(
    async (user: TeamUser, newRole: UserRole) => {
      try {
        await patchUserRole(user.id, newRole);
        toast.success(t("app.settings.users.roleUpdated"));
        load();
      } catch {
        toast.error(t("app.settings.users.roleUpdateError"));
      }
    },
    [load, t, toast],
  );

  const handleResetPassword = useCallback(
    async (user: TeamUser) => {
      try {
        await resetPassword(user.id);
        toast.success(t("app.settings.users.resetPasswordSent", { email: user.email }));
      } catch {
        toast.error(t("app.settings.users.resetPasswordError"));
      }
    },
    [t, toast],
  );

  const handleGenerateLink = useCallback(
    async (user: TeamUser) => {
      try {
        const link = await generateInviteLink(user.id);
        await navigator.clipboard.writeText(link);
        toast.success(t("app.settings.users.inviteLinkCopied"));
      } catch {
        toast.error(t("app.settings.users.inviteLinkError"));
      }
    },
    [t, toast],
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await deleteUser(deleteTarget.id);
      toast.success(t("app.settings.users.deleteSuccess", { name: fullName(deleteTarget) }));
      setDeleteTarget(null);
      load();
    } catch {
      toast.error(t("app.settings.users.deleteError"));
    } finally {
      setDeleteLoading(false);
    }
  }, [deleteTarget, load, t, toast]);

  const columns: ColumnDef<TeamUser>[] = [
    {
      id: "name",
      header: t("app.settings.users.columns.name"),
      cell: ({ row }) => {
        const u = row.original;
        const name = fullName(u);
        return (
          <div className="gc-users-table__name-cell">
            <Avatar
              src={u.avatarUrl}
              fallback={name}
              size="small"
            />
            <span className="gc-users-table__name">
              {name}
              {u.isPending && (
                <Tag variant="warning" size="small" className="gc-users-table__pending-tag">
                  {t("app.settings.users.pending")}
                </Tag>
              )}
            </span>
          </div>
        );
      },
    },
    {
      id: "email",
      header: t("app.settings.users.columns.email"),
      cell: ({ row }) => (
        <span className="gc-users-table__email">{row.original.email}</span>
      ),
    },
    {
      id: "role",
      header: t("app.settings.users.columns.role"),
      cell: ({ row }) => {
        const u = row.original;
        const roleItems: DropdownItem[] = ALL_ROLES.map((r) => ({
          id: r,
          label: roleLabel(r),
          onSelect: () => { void handleRoleChange(u, r); },
        }));
        roleItems.push(
          { id: "sep", separator: true, label: undefined },
          {
            id: "docs",
            label: t("app.settings.users.roleDocsLink"),
            icon: "external-link",
            onSelect: () => {
              window.open("https://docs.graphcaster.io/rbac", "_blank", "noopener");
            },
          },
        );

        return (
          <DropdownMenu
            trigger={
              <button
                type="button"
                className="gc-users-table__role-trigger"
                aria-label={t("app.settings.users.editRoleAria", { role: roleLabel(u.role) })}
                data-testid={`role-trigger-${u.id}`}
              >
                <Tag variant={ROLE_VARIANT[u.role]} size="small">
                  {roleLabel(u.role)}
                </Tag>
              </button>
            }
            items={roleItems}
            align="start"
          />
        );
      },
    },
    {
      id: "lastActive",
      header: t("app.settings.users.columns.lastActive"),
      cell: ({ row }) => (
        <span className="gc-users-table__last-active">
          {formatRelative(row.original.lastActive)}
        </span>
      ),
    },
    {
      id: "projects",
      header: t("app.settings.users.columns.projects"),
      cell: ({ row }) => (
        <span className="gc-users-table__projects">
          {row.original.projectCount ?? 0}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const u = row.original;
        const items: DropdownItem[] = [
          {
            id: "generate-link",
            label: t("app.settings.users.actions.generateInviteLink"),
            icon: "link",
            onSelect: () => { void handleGenerateLink(u); },
          },
          {
            id: "reset-password",
            label: t("app.settings.users.actions.resetPassword"),
            icon: "key",
            onSelect: () => { void handleResetPassword(u); },
          },
          {
            id: "delete-sep",
            separator: true,
            label: undefined,
          },
          {
            id: "delete",
            label: t("app.settings.users.actions.delete"),
            icon: "trash-2",
            destructive: true,
            onSelect: () => setDeleteTarget(u),
          },
        ];

        return (
          <DropdownMenu
            trigger={
              <Button
                variant="ghost"
                size="xsmall"
                iconLeft="ellipsis"
                aria-label={t("app.settings.users.actionsAria", { name: fullName(u) })}
                data-testid={`actions-trigger-${u.id}`}
              />
            }
            items={items}
            align="end"
          />
        );
      },
    },
  ];

  const roleFilterOptions = [
    { value: "all", label: t("app.settings.users.filterRoleAll") },
    ...ALL_ROLES.map((r) => ({ value: r, label: roleLabel(r) })),
  ];

  const emptyState = (
    <div className="gc-users-empty" data-testid="users-empty-state">
      <Text color="muted" size="medium">
        {t("app.settings.users.emptyTitle")}
      </Text>
      <Button
        variant="outline"
        size="small"
        className="gc-users-empty__cta"
        onClick={() => openModal(INVITE_USERS_MODAL_KEY)}
        data-testid="empty-invite-btn"
      >
        {t("app.settings.users.emptyCta")}
      </Button>
    </div>
  );

  return (
    <div className="gc-users-page" data-testid="users-page">
      <div className="gc-users-page__header">
        <Heading level={2} size="xl">
          {t("app.settings.users.title")}
        </Heading>
        <Button
          variant="solid"
          iconLeft="user-check"
          onClick={() => openModal(INVITE_USERS_MODAL_KEY)}
          data-testid="invite-btn"
        >
          {t("app.settings.users.inviteButton")}
        </Button>
      </div>

      <div className="gc-users-page__filters">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("app.settings.users.searchPlaceholder")}
          iconLeft="search"
          clearable
          onClear={() => setSearch("")}
          aria-label={t("app.settings.users.searchAria")}
          data-testid="users-search"
        />
        <Select
          value={roleFilter}
          onValueChange={setRoleFilter}
          options={roleFilterOptions}
          aria-label={t("app.settings.users.filterRoleAria")}
          data-testid="role-filter"
        />
      </div>

      {pendingInvitations.length > 0 && (
        <section
          className="gc-users-pending"
          data-testid="pending-invitations-section"
          aria-label={t("app.settings.users.pendingInvitations.heading")}
        >
          <Heading level={3} size="md">
            {t("app.settings.users.pendingInvitations.heading")}
          </Heading>
          <ul className="gc-users-pending__list" data-testid="pending-invitations-list">
            {pendingInvitations.map((inv) => (
              <li
                key={inv.id}
                className="gc-users-pending__row"
                data-testid={`pending-invitation-${inv.id}`}
              >
                <span className="gc-users-pending__email" data-testid={`pending-invitation-email-${inv.id}`}>
                  {inv.email}
                </span>
                <span data-testid={`pending-invitation-role-${inv.id}`}>
                  <Tag variant={ROLE_VARIANT[inv.role]} size="small">
                    {roleLabel(inv.role)}
                  </Tag>
                </span>
                <Text size="sm" color="secondary" className="gc-users-pending__time">
                  {formatPendingAgo(inv.invitedAt)}
                </Text>
                <div className="gc-users-pending__actions">
                  <Button
                    size="xsmall"
                    variant="ghost"
                    iconLeft="send"
                    onClick={() => { void handleResendInvitation(inv); }}
                    data-testid={`pending-resend-${inv.id}`}
                  >
                    {t("app.settings.users.pendingInvitations.resend")}
                  </Button>
                  <Button
                    size="xsmall"
                    variant="ghost"
                    iconLeft="trash-2"
                    onClick={() => setRevokeTarget(inv)}
                    data-testid={`pending-revoke-${inv.id}`}
                  >
                    {t("app.settings.users.pendingInvitations.revoke")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <DataTableServer
        data={users}
        columns={columns}
        totalRows={total}
        currentPage={page}
        onPageChange={setPage}
        pageSize={PAGE_SIZE}
        loading={loading}
        emptyState={emptyState}
        className="gc-users-table"
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={t("app.settings.users.deleteModal.title")}
        description={t("app.settings.users.deleteModal.description", {
          name: deleteTarget ? fullName(deleteTarget) : "",
        })}
        confirmLabel={t("app.settings.users.deleteModal.confirm")}
        cancelLabel={t("app.settings.users.deleteModal.cancel")}
        destructive
        loading={deleteLoading}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />

      <AlertDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => { if (!open) setRevokeTarget(null); }}
        title={t("app.settings.users.pendingInvitations.revokeConfirmTitle")}
        description={t("app.settings.users.pendingInvitations.revokeConfirmDescription", {
          email: revokeTarget?.email ?? "",
        })}
        confirmLabel={t("app.settings.users.pendingInvitations.revokeConfirmYes")}
        cancelLabel={t("app.settings.users.pendingInvitations.revokeConfirmCancel")}
        destructive
        onConfirm={() => { void handleRevokeInvitation(); }}
        onCancel={() => setRevokeTarget(null)}
      />

      <InviteUsersModal onInvited={loadPending} />
    </div>
  );
}
