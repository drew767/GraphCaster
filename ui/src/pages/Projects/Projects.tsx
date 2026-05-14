// Copyright GraphCaster. All Rights Reserved.

import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import {
  AlertDialog,
  Badge,
  Button,
  Card,
  Dialog,
  Heading,
  Icon,
  Input,
  Text,
} from "../../components/ui";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectSummary {
  id: string;
  name: string;
  description?: string;
  memberCount: number;
  workflowCount: number;
  lastActivityAt?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchProjects(): Promise<ProjectSummary[]> {
  const resp = await fetch("/api/v1/projects");
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json() as Promise<ProjectSummary[]>;
}

async function deleteProject(id: string): Promise<void> {
  const resp = await fetch(`/api/v1/projects/${id}`, { method: "DELETE" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

async function createProject(payload: { name: string; description?: string }): Promise<ProjectSummary> {
  const resp = await fetch("/api/v1/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json() as Promise<ProjectSummary>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// ProjectCard
// ---------------------------------------------------------------------------

interface ProjectCardProps {
  project: ProjectSummary;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onOpen: (id: string) => void;
}

function ProjectCard({ project, onEdit, onDelete, onOpen }: ProjectCardProps) {
  const { t } = useTranslation();

  return (
    <div
      data-testid="project-card"
      role="button"
      tabIndex={0}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        onOpen(project.id);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(project.id);
        }
      }}
      className="gc-project-card-wrap"
    >
    <Card
      variant="outlined"
      padding="medium"
      hoverable
      className="gc-project-card"
    >
      <Card.Header
        title={
          <span className="gc-project-card__name">{project.name}</span>
        }
        actions={
          <Badge
            text={t("app.projects.memberCount", { count: project.memberCount })}
            variant="neutral"
            size="small"
          />
        }
      />
      <Card.Body>
        {project.description && (
          <Text size="small" color="subtle" className="gc-project-card__description">
            {project.description}
          </Text>
        )}
        <div className="gc-project-card__meta">
          <span className="gc-project-card__stat">
            <Icon name="git-branch" size={13} aria-hidden />
            <Text size="xsmall">
              {t("app.projects.workflowCount", { count: project.workflowCount })}
            </Text>
          </span>
          {project.lastActivityAt && (
            <Text size="xsmall" color="subtle">
              {t("app.projects.lastActivity", { when: relativeTime(project.lastActivityAt) })}
            </Text>
          )}
        </div>
      </Card.Body>
      <Card.Footer>
        <div className="gc-project-card__actions">
          <Button
            variant="ghost"
            size="xsmall"
            iconLeft="pencil"
            onClick={() => onEdit(project.id)}
            aria-label={t("app.projects.actionEdit")}
          >
            {t("app.projects.actionEdit")}
          </Button>
          <Button
            variant="ghost"
            size="xsmall"
            iconLeft="trash-2"
            onClick={() => onDelete(project.id)}
            aria-label={t("app.projects.actionDelete")}
          >
            {t("app.projects.actionDelete")}
          </Button>
          <Button
            variant="solid"
            size="xsmall"
            iconLeft="arrow-right"
            onClick={() => onOpen(project.id)}
          >
            {t("app.projects.actionOpen")}
          </Button>
        </div>
      </Card.Footer>
    </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------

function EmptyState({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="gc-projects-empty" data-testid="projects-empty-state">
      <Icon name="folder" size={40} />
      <Text size="large" weight="medium">{t("app.projects.emptyTitle")}</Text>
      <Text size="small" color="subtle">{t("app.projects.emptySubtitle")}</Text>
      <Button variant="solid" iconLeft="plus" onClick={onAdd}>
        {t("app.projects.newButton")}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ProjectsView() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);
  const [deleteWorking, setDeleteWorking] = useState(false);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createWorking, setCreateWorking] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchProjects()
      .then((data) => { if (!cancelled) setProjects(data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : t("app.projects.loadError")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [t]);

  const handleNew = useCallback(() => {
    setCreateName("");
    setCreateDescription("");
    setCreateError(null);
    setCreateOpen(true);
  }, []);

  const handleCreateSubmit = useCallback(async () => {
    const name = createName.trim();
    if (!name) {
      setCreateError(t("app.projects.nameRequired"));
      return;
    }
    setCreateWorking(true);
    setCreateError(null);
    try {
      const created = await createProject({ name, description: createDescription.trim() || undefined });
      setProjects((prev) => [created, ...prev]);
      setCreateOpen(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : t("app.projects.loadError"));
    } finally {
      setCreateWorking(false);
    }
  }, [createName, createDescription, t]);

  const handleEdit = useCallback((id: string) => {
    navigate(`/projects/${id}/settings`);
  }, [navigate]);

  const handleOpen = useCallback((id: string) => {
    navigate(`/projects/${id}`);
  }, [navigate]);

  const handleDeleteRequest = useCallback((id: string) => {
    const p = projects.find((pr) => pr.id === id) ?? null;
    setDeleteTarget(p);
  }, [projects]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleteWorking(true);
    try {
      await deleteProject(deleteTarget.id);
      setProjects((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      setDeleteTarget(null);
    } finally {
      setDeleteWorking(false);
    }
  }, [deleteTarget]);

  return (
    <div className="gc-projects-page" data-testid="projects-page">
      <div className="gc-projects-page__header">
        <Heading level={1} size="xl">
          {t("app.projects.title")}
        </Heading>
        <Button
          variant="solid"
          iconLeft="plus"
          size="small"
          onClick={handleNew}
          data-testid="projects-new-button"
        >
          {t("app.projects.newButton")}
        </Button>
      </div>

      {error && (
        <div role="alert" style={{ marginBottom: 12 }}>
          <Text color="danger">{error}</Text>
        </div>
      )}

      {!loading && projects.length > 0 && (
        <div className="gc-projects-page__filters" style={{ marginBottom: 12 }}>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("app.projects.searchPlaceholder")}
            aria-label={t("app.projects.searchAriaLabel")}
            data-testid="projects-search-input"
            iconLeft="search"
          />
        </div>
      )}

      {loading ? (
        <div className="gc-projects-page__loading" data-testid="projects-loading">
          <Icon name="loader" size={24} />
        </div>
      ) : projects.length === 0 ? (
        <EmptyState onAdd={handleNew} />
      ) : (
        (() => {
          const q = search.trim().toLowerCase();
          const filtered = q
            ? projects.filter(
                (p) =>
                  p.name.toLowerCase().includes(q) ||
                  (p.description ?? "").toLowerCase().includes(q),
              )
            : projects;
          if (filtered.length === 0) {
            return (
              <div
                className="gc-projects-page__no-results"
                data-testid="projects-no-results"
                style={{ padding: 24 }}
              >
                <Text color="subtle">
                  {t("app.projects.noResults", { query: search })}
                </Text>
              </div>
            );
          }
          return (
            <div className="gc-projects-page__grid" data-testid="projects-grid">
              {filtered.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  onEdit={handleEdit}
                  onDelete={handleDeleteRequest}
                  onOpen={handleOpen}
                />
              ))}
            </div>
          );
        })()
      )}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}
        title={t("app.projects.deleteTitle")}
        description={t("app.projects.deleteDescription", { name: deleteTarget?.name ?? "" })}
        confirmLabel={t("app.projects.deleteConfirm")}
        cancelLabel={t("app.projects.deleteCancel")}
        destructive
        onConfirm={handleDeleteConfirm}
        loading={deleteWorking}
      />

      <Dialog
        open={createOpen}
        onOpenChange={(v) => { if (!v) setCreateOpen(false); }}
        title={t("app.projects.newButton")}
        size="small"
        data-testid="projects-create-dialog"
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="outline" size="small" onClick={() => setCreateOpen(false)}>
              {t("app.projects.deleteCancel")}
            </Button>
            <Button
              variant="solid"
              size="small"
              loading={createWorking}
              onClick={handleCreateSubmit}
              data-testid="projects-create-submit"
            >
              {t("app.projects.newButton")}
            </Button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Input
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder={t("app.projects.settings.namePlaceholder")}
            aria-label={t("app.projects.settings.name")}
            data-testid="projects-create-name"
          />
          <Input
            value={createDescription}
            onChange={(e) => setCreateDescription(e.target.value)}
            placeholder={t("app.projects.settings.descriptionPlaceholder")}
            aria-label={t("app.projects.settings.description")}
            data-testid="projects-create-description"
          />
          {createError && <Text size="small" color="danger">{createError}</Text>}
        </div>
      </Dialog>
    </div>
  );
}
