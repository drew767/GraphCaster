// Copyright GraphCaster. All Rights Reserved.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Badge,
  Button,
  Checkbox,
  DropdownMenu,
  Icon,
  Input,
  Pill,
  Select,
  Text,
} from "../../components/ui";
import { EmptyState } from "../../components/ui/EmptyState/EmptyState";
import { SkeletonCard } from "../../components/ui/Skeleton/Skeleton";
import { useUIStore } from "../../app/stores/uiStore";
import { useToast } from "../../toast/ToastProvider";
import {
  getCredentialTypeIcon,
  getCredentialTypeLabel,
  CREDENTIAL_TYPES,
} from "./credentialTypes";
import { CredentialUsagesDrawer } from "./CredentialUsagesDrawer";
import { CredentialShareModal } from "./CredentialShareModal";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CREDENTIALS_FILTER_TYPE_STORAGE_KEY = "gc.credentials.filterType";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CredentialSummary {
  id: string;
  name: string;
  type: string;
  description?: string;
  provider: "env" | "file" | "vault" | "aws-sm";
  status: "ready" | "setup-needed" | "expired" | "invalid";
  usedByWorkflowCount: number;
  ownerId?: string;
  ownerName?: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchCredentials(): Promise<CredentialSummary[]> {
  const resp = await fetch("/api/v1/credentials");
  if (resp.status === 404) {
    throw new NotConfiguredError();
  }
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  return resp.json() as Promise<CredentialSummary[]>;
}

class NotConfiguredError extends Error {
  constructor() {
    super("not-configured");
  }
}

// ---------------------------------------------------------------------------
// CredentialCard
// ---------------------------------------------------------------------------

interface CredentialCardProps {
  credential: CredentialSummary;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onTest: (id: string) => void;
  onDuplicate: (id: string) => void;
  onMove: (id: string) => void;
  onShowUsages: (cred: CredentialSummary) => void;
  onShare: (cred: CredentialSummary) => void;
}

function StatusIndicator({ status }: { status: CredentialSummary["status"] }) {
  const { t } = useTranslation();
  if (status === "ready") {
    return (
      <span className="gc-cred-card__status gc-cred-card__status--ready" aria-label={t("app.credentials.statusReady")}>
        <Icon name="circle-check" size={13} />
        <span>{t("app.credentials.statusReady")}</span>
      </span>
    );
  }
  if (status === "setup-needed") {
    return (
      <span className="gc-cred-card__status gc-cred-card__status--setup-needed" aria-label={t("app.credentials.statusSetupNeeded")}>
        <Icon name="triangle-alert" size={13} />
        <span>{t("app.credentials.statusSetupNeeded")}</span>
      </span>
    );
  }
  if (status === "expired") {
    return (
      <span className="gc-cred-card__status gc-cred-card__status--expired" aria-label={t("app.credentials.statusExpired")}>
        <Icon name="clock" size={13} />
        <span>{t("app.credentials.statusExpired")}</span>
      </span>
    );
  }
  return (
    <span className="gc-cred-card__status gc-cred-card__status--invalid" aria-label={t("app.credentials.statusInvalid")}>
      <Icon name="circle-x" size={13} />
      <span>{t("app.credentials.statusInvalid")}</span>
    </span>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function CredentialCard({
  credential,
  onEdit,
  onDelete,
  onTest,
  onDuplicate,
  onMove,
  onShowUsages,
  onShare,
}: CredentialCardProps) {
  const { t } = useTranslation();
  const icon = getCredentialTypeIcon(credential.type);
  const typeLabel = getCredentialTypeLabel(credential.type);

  const menuItems = [
    { id: "edit", label: t("app.credentials.actionEdit"), icon: "pencil" as const, onSelect: () => onEdit(credential.id) },
    { id: "test", label: t("app.credentials.actionTest"), icon: "circle-play" as const, onSelect: () => onTest(credential.id) },
    { id: "share", label: t("credentials.share.menuItem"), icon: "users" as const, onSelect: () => onShare(credential) },
    { id: "duplicate", label: t("app.credentials.actionDuplicate"), icon: "copy" as const, onSelect: () => onDuplicate(credential.id) },
    { id: "move", label: t("app.credentials.actionMove"), icon: "arrow-right" as const, onSelect: () => onMove(credential.id) },
    { id: "sep-del", separator: true },
    { id: "delete", label: t("app.credentials.actionDelete"), icon: "trash-2" as const, destructive: true, onSelect: () => onDelete(credential.id) },
  ];

  const usagesCount = credential.usedByWorkflowCount;
  const usagesLabel =
    usagesCount === 0
      ? t("credentials.usages.pillLabelZero")
      : t(
          usagesCount === 1
            ? "credentials.usages.pillLabel"
            : "credentials.usages.pillLabel_plural",
          { count: usagesCount },
        );

  return (
    <div className="gc-cred-card" data-testid="credential-card">
      <div className="gc-cred-card__header">
        <span className="gc-cred-card__type-icon" aria-hidden>
          <Icon name={icon} size={20} />
        </span>
        <div className="gc-cred-card__titles">
          <span className="gc-cred-card__name" title={credential.name}>{credential.name}</span>
          <span className="gc-cred-card__type-label">{typeLabel}</span>
        </div>
        <DropdownMenu
          trigger={
            <button
              type="button"
              className="gc-cred-card__menu-btn"
              aria-label={t("app.credentials.cardMenuAriaLabel")}
            >
              <Icon name="ellipsis" size={16} />
            </button>
          }
          items={menuItems}
          align="end"
        />
      </div>

      <StatusIndicator status={credential.status} />

      <div className="gc-cred-card__meta">
        <button
          type="button"
          className="gc-cred-card__usages-pill"
          onClick={() => onShowUsages(credential)}
          data-testid={`credential-usages-pill-${credential.id}`}
          aria-label={usagesLabel}
        >
          <Pill variant={usagesCount > 0 ? "info" : "default"} size="small" icon="git-branch">
            {usagesLabel}
          </Pill>
        </button>
        {credential.ownerName && (
          <Badge text={credential.ownerName} variant="neutral" size="small" />
        )}
      </div>

      <div className="gc-cred-card__footer">
        <Text size="xsmall" color="muted">
          {t("app.credentials.updatedRelative", { when: relativeTime(credential.updatedAt) })}
        </Text>
      </div>
    </div>
  );
}

// Empty state removed — using shared EmptyState component below

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const ALL_TYPES_VALUE = "__all__";

function readPersistedTypeFilter(): string {
  try {
    const raw = localStorage.getItem(CREDENTIALS_FILTER_TYPE_STORAGE_KEY);
    if (raw && typeof raw === "string") return raw;
  } catch {
    /* ignore */
  }
  return ALL_TYPES_VALUE;
}

export default function CredentialsView() {
  const { t } = useTranslation();

  const { toast } = useToast();
  const openModal = useUIStore((s) => s.openModal);

  const [credentials, setCredentials] = useState<CredentialSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>(() => readPersistedTypeFilter());
  const [setupNeededOnly, setSetupNeededOnly] = useState(false);
  const [usagesTarget, setUsagesTarget] = useState<CredentialSummary | null>(null);
  const [shareTarget, setShareTarget] = useState<CredentialSummary | null>(null);

  // Type filter options are derived from CREDENTIAL_TYPES catalog augmented with
  // any types observed in the loaded credentials list (UXP96).
  const TYPE_OPTIONS = useMemo(() => {
    const knownTypes = new Set(CREDENTIAL_TYPES.map((c) => c.type));
    const extras = credentials
      .map((c) => c.type)
      .filter((t) => !knownTypes.has(t))
      .filter((t, i, arr) => arr.indexOf(t) === i)
      .map((t) => ({ value: t, label: t }));
    return [
      { value: ALL_TYPES_VALUE, label: t("credentials.filter.typeAll") },
      ...CREDENTIAL_TYPES.map((ct) => ({ value: ct.type, label: ct.label })),
      ...extras,
    ];
  }, [credentials, t]);

  // Persist the selected type filter so the user lands back on it after reload.
  useEffect(() => {
    try {
      localStorage.setItem(CREDENTIALS_FILTER_TYPE_STORAGE_KEY, typeFilter);
    } catch {
      /* ignore */
    }
  }, [typeFilter]);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCredentials()
      .then((data) => {
        if (!cancelled) setCredentials(data);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof NotConfiguredError) {
          setCredentials([]);
          toast.warning(t("app.credentials.notConfiguredWarning"), { duration: 0 });
        } else {
          toast.error(t("app.credentials.loadError"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t, toast]);

  const filtered = useMemo(() => {
    return credentials.filter((c) => {
      if (typeFilter && typeFilter !== ALL_TYPES_VALUE && c.type !== typeFilter) return false;
      if (setupNeededOnly && c.status !== "setup-needed") return false;
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase();
        if (!c.name.toLowerCase().includes(q) && !c.type.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [credentials, typeFilter, setupNeededOnly, debouncedSearch]);

  const openNew = useCallback(() => {
    openModal("credential-edit");
  }, [openModal]);

  const openEdit = useCallback((id: string) => {
    openModal("credential-edit", { id });
  }, [openModal]);

  const handleDelete = useCallback((id: string) => {
    setCredentials((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const handleTest = useCallback((_id: string) => {
    toast.info(t("app.credentials.testTriggered"));
  }, [toast, t]);

  const handleDuplicate = useCallback((_id: string) => {
    toast.info(t("app.credentials.duplicateTriggered"));
  }, [toast, t]);

  const handleMove = useCallback((_id: string) => {
    toast.info(t("app.credentials.moveTriggered"));
  }, [toast, t]);

  const handleShowUsages = useCallback((cred: CredentialSummary) => {
    setUsagesTarget(cred);
  }, []);

  const handleShare = useCallback((cred: CredentialSummary) => {
    setShareTarget(cred);
  }, []);

  return (
    <div className="gc-credentials-page" data-testid="credentials-page">
      <div className="gc-credentials-page__toolbar">
        <h1 className="gc-credentials-page__title">{t("app.credentials.pageTitle")}</h1>
        <div className="gc-credentials-page__actions">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("credentials.filter.searchPlaceholder")}
            iconLeft="search"
            size="small"
            clearable
            onClear={() => setSearch("")}
            aria-label={t("credentials.filter.searchAria")}
            data-testid="credentials-search-input"
          />
          <Button variant="solid" iconLeft="plus" size="small" onClick={openNew}>
            {t("app.credentials.newButton")}
          </Button>
        </div>
      </div>

      <div className="gc-credentials-page__filters">
        <Select
          value={typeFilter}
          onValueChange={setTypeFilter}
          options={TYPE_OPTIONS}
          placeholder={t("credentials.filter.typeLabel")}
          size="small"
          data-testid="credentials-type-filter"
        />
        <label className="gc-credentials-page__setup-toggle">
          <Checkbox
            checked={setupNeededOnly}
            onCheckedChange={(v) => setSetupNeededOnly(v)}
            id="cred-setup-only"
          />
          <span>{t("app.credentials.filterSetupNeeded")}</span>
        </label>
      </div>

      {loading ? (
        <div className="gc-credentials-page__skeleton-grid" data-testid="credentials-loading">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="key-round"
          title={t("app.empty.credentials.title")}
          description={t("app.empty.credentials.description")}
          action={{
            label: t("app.empty.credentials.action"),
            onClick: openNew,
          }}
          data-testid="credentials-empty-state"
        />
      ) : (
        <div className="gc-credentials-page__grid" data-testid="credentials-grid">
          {filtered.map((cred) => (
            <CredentialCard
              key={cred.id}
              credential={cred}
              onEdit={openEdit}
              onDelete={handleDelete}
              onTest={handleTest}
              onDuplicate={handleDuplicate}
              onMove={handleMove}
              onShowUsages={handleShowUsages}
              onShare={handleShare}
            />
          ))}
        </div>
      )}

      {usagesTarget && (
        <CredentialUsagesDrawer
          open={Boolean(usagesTarget)}
          credentialId={usagesTarget.id}
          credentialName={usagesTarget.name}
          onClose={() => setUsagesTarget(null)}
        />
      )}

      {shareTarget && (
        <CredentialShareModal
          open={Boolean(shareTarget)}
          credentialId={shareTarget.id}
          credentialName={shareTarget.name}
          onClose={() => setShareTarget(null)}
        />
      )}
    </div>
  );
}
