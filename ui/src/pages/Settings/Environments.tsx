// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Button,
  Dialog,
  Heading,
  Input,
  Notice,
  Select,
  Tag,
} from "../../components/ui";

export interface Environment {
  id: string;
  name: string;
  active: boolean;
  variablesCount?: number;
  credentialsCount?: number;
}

const STORAGE_KEY = "gc.environments";

const DEFAULT_ENVIRONMENTS: Environment[] = [
  { id: "prod", name: "Production", active: true, variablesCount: 12, credentialsCount: 4 },
  { id: "dev", name: "Development", active: false, variablesCount: 8, credentialsCount: 2 },
];

function readEnvironments(): Environment[] {
  if (typeof localStorage === "undefined") return [...DEFAULT_ENVIRONMENTS];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_ENVIRONMENTS];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [...DEFAULT_ENVIRONMENTS];
    }
    return (parsed as Environment[]).map((env) => ({
      id: String(env.id),
      name: String(env.name),
      active: Boolean(env.active),
      variablesCount: typeof env.variablesCount === "number" ? env.variablesCount : 0,
      credentialsCount: typeof env.credentialsCount === "number" ? env.credentialsCount : 0,
    }));
  } catch {
    return [...DEFAULT_ENVIRONMENTS];
  }
}

function writeEnvironments(envs: Environment[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(envs));
  } catch {
    /* ignore */
  }
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `env-${Date.now()}`;
}

export default function EnvironmentsPage() {
  const { t } = useTranslation();
  const [envs, setEnvs] = useState<Environment[]>(() => readEnvironments());
  const [modalOpen, setModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [cloneFrom, setCloneFrom] = useState<string>("__none__");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");

  useEffect(() => {
    writeEnvironments(envs);
  }, [envs]);

  const sortedEnvs = useMemo(() => envs, [envs]);

  const activate = useCallback((id: string) => {
    setEnvs((prev) => prev.map((e) => ({ ...e, active: e.id === id })));
  }, []);

  const remove = useCallback(
    (id: string) => {
      if (id === "prod") return;
      const env = envs.find((e) => e.id === id);
      if (!env) return;
      const confirmMsg = t("settings.environments.confirmDelete", { name: env.name });
      if (typeof window !== "undefined" && !window.confirm(confirmMsg)) return;
      setEnvs((prev) => {
        const next = prev.filter((e) => e.id !== id);
        if (!next.some((e) => e.active) && next.length > 0) {
          next[0] = { ...next[0], active: true };
        }
        return next;
      });
    },
    [envs, t],
  );

  const startRename = useCallback((env: Environment) => {
    if (env.id === "prod") return;
    setEditingId(env.id);
    setEditingDraft(env.name);
  }, []);

  const commitRename = useCallback(() => {
    if (!editingId) return;
    const name = editingDraft.trim();
    if (!name) {
      setEditingId(null);
      return;
    }
    setEnvs((prev) =>
      prev.map((e) => (e.id === editingId ? { ...e, name } : e)),
    );
    setEditingId(null);
  }, [editingId, editingDraft]);

  const handleCreate = useCallback(() => {
    const name = newName.trim();
    if (!name) return;
    const id = (() => {
      const base = slugify(name);
      if (!envs.some((e) => e.id === base)) return base;
      let i = 2;
      while (envs.some((e) => e.id === `${base}-${i}`)) i++;
      return `${base}-${i}`;
    })();
    const source =
      cloneFrom && cloneFrom !== "__none__"
        ? envs.find((e) => e.id === cloneFrom)
        : null;
    const created: Environment = {
      id,
      name,
      active: false,
      variablesCount: source?.variablesCount ?? 0,
      credentialsCount: source?.credentialsCount ?? 0,
    };
    setEnvs((prev) => [...prev, created]);
    setModalOpen(false);
    setNewName("");
    setCloneFrom("__none__");
  }, [newName, cloneFrom, envs]);

  const cloneOptions = useMemo(
    () => [
      { value: "__none__", label: t("settings.environments.modal.cloneNone") },
      ...envs.map((e) => ({ value: e.id, label: e.name })),
    ],
    [envs, t],
  );

  return (
    <div data-testid="environments-page">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <Heading level={2} size="xl">
          {t("settings.environments.title")}
        </Heading>
        <Button
          variant="solid"
          size="small"
          iconLeft="plus"
          onClick={() => setModalOpen(true)}
          data-testid="environments-new-btn"
        >
          {t("settings.environments.newEnvironment")}
        </Button>
      </div>

      <div style={{ marginBottom: 16 }} data-testid="environments-banner">
        <Notice type="info">{t("settings.environments.banner")}</Notice>
      </div>

      <ul
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          listStyle: "none",
          padding: 0,
          margin: 0,
        }}
        role="list"
        data-testid="environments-list"
      >
        {sortedEnvs.map((env) => {
          const isProd = env.id === "prod";
          const isEditing = editingId === env.id;
          return (
            <li
              key={env.id}
              data-testid={`environment-card-${env.id}`}
              style={{
                border: "1px solid var(--color--border, rgba(0,0,0,0.08))",
                borderRadius: 8,
                padding: 14,
                display: "flex",
                alignItems: "center",
                gap: 16,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 6,
                  }}
                >
                  {isEditing ? (
                    <Input
                      size="small"
                      value={editingDraft}
                      onChange={(e) => setEditingDraft(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRename();
                        } else if (e.key === "Escape") {
                          setEditingId(null);
                        }
                      }}
                      data-testid={`environment-rename-${env.id}`}
                      autoFocus
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => startRename(env)}
                      style={{
                        background: "transparent",
                        border: "none",
                        cursor: isProd ? "default" : "pointer",
                        font: "inherit",
                        padding: 0,
                        color: "inherit",
                        fontWeight: 600,
                      }}
                      data-testid={`environment-name-${env.id}`}
                      disabled={isProd}
                    >
                      {env.name}
                    </button>
                  )}
                  {env.active && (
                    <span data-testid={`environment-active-${env.id}`}>
                      <Tag size="small" variant="primary">
                        {t("settings.environments.active")}
                      </Tag>
                    </span>
                  )}
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 16,
                    fontSize: 12,
                    color: "var(--color--text--tint-2, rgba(28,28,30,0.55))",
                  }}
                >
                  <a
                    href={`/settings/variables?env=${env.id}`}
                    style={{ color: "inherit", textDecoration: "underline" }}
                    data-testid={`environment-variables-${env.id}`}
                  >
                    {t("settings.environments.variables", {
                      count: env.variablesCount ?? 0,
                    })}
                  </a>
                  <span data-testid={`environment-credentials-${env.id}`}>
                    {t("settings.environments.credentials", {
                      count: env.credentialsCount ?? 0,
                    })}
                  </span>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                {!env.active && (
                  <Button
                    size="xsmall"
                    variant="outline"
                    onClick={() => activate(env.id)}
                    data-testid={`environment-switch-${env.id}`}
                  >
                    {t("settings.environments.switchTo")}
                  </Button>
                )}
                <Button
                  size="xsmall"
                  variant="destructive"
                  iconLeft="trash-2"
                  onClick={() => remove(env.id)}
                  disabled={isProd}
                  aria-label={t("settings.environments.delete")}
                  title={isProd ? t("settings.environments.cantDeleteProduction") : undefined}
                  data-testid={`environment-delete-${env.id}`}
                >
                  {t("settings.environments.delete")}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <Dialog
        open={modalOpen}
        onOpenChange={setModalOpen}
        size="small"
        title={t("settings.environments.modal.title")}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button
              size="small"
              variant="ghost"
              onClick={() => setModalOpen(false)}
              data-testid="environments-modal-cancel"
            >
              {t("settings.environments.modal.cancel")}
            </Button>
            <Button
              size="small"
              variant="solid"
              onClick={handleCreate}
              disabled={!newName.trim()}
              data-testid="environments-modal-create"
            >
              {t("settings.environments.modal.create")}
            </Button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>
              {t("settings.environments.namePlaceholder")}
            </label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("settings.environments.modal.namePlaceholder")}
              data-testid="environments-modal-name"
              autoFocus
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>
              {t("settings.environments.modal.cloneFrom")}
            </label>
            <Select
              value={cloneFrom}
              onValueChange={(v) => setCloneFrom(v)}
              options={cloneOptions}
              data-testid="environments-modal-clone"
            />
          </div>
        </div>
      </Dialog>
    </div>
  );
}
