// Copyright GraphCaster. All Rights Reserved.

import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "../ui/Icon/Icon";
import { Select } from "../ui/Select/Select";
import { useToast } from "../../toast/ToastProvider";
import type { SelectOption } from "../ui/Select/Select";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkflowVersion {
  version: number;
  label?: string;
}

export interface NodeChange {
  id: string;
  name?: string;
  fields?: Array<{ key: string; before: string; after: string }>;
}

export interface EdgeChange {
  id: string;
  description: string;
}

export interface DiffResult {
  nodesAdded: Array<{ id: string; name?: string }>;
  nodesRemoved: Array<{ id: string; name?: string }>;
  nodesModified: NodeChange[];
  edgesAdded: EdgeChange[];
  edgesRemoved: EdgeChange[];
}

export interface WorkflowDiffViewProps {
  graphId: string;
  versions: WorkflowVersion[];
  initialVersionA?: number;
  initialVersionB?: number;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchDiff(graphId: string, a: number, b: number): Promise<DiffResult> {
  const resp = await fetch(`/api/v1/graphs/${graphId}/diff?a=${a}&b=${b}`);
  if (resp.status === 404) {
    const err = new Error("not_found");
    err.name = "NotFound";
    throw err;
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json() as Promise<DiffResult>;
}

// ---------------------------------------------------------------------------
// Field diff row
// ---------------------------------------------------------------------------

interface FieldDiffRowProps {
  fieldKey: string;
  before: string;
  after: string;
}

function FieldDiffRow({ fieldKey, before, after }: FieldDiffRowProps) {
  return (
    <div className="gc-diff-field-row" data-testid={`diff-field-${fieldKey}`}>
      <span className="gc-diff-field-row__key">{fieldKey}</span>
      <div className="gc-diff-field-row__values">
        <span className="gc-diff-field-row__before" data-testid={`diff-field-before-${fieldKey}`}>
          {before}
        </span>
        <Icon name="arrow-right" size={12} />
        <span className="gc-diff-field-row__after" data-testid={`diff-field-after-${fieldKey}`}>
          {after}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modified node card (expandable)
// ---------------------------------------------------------------------------

interface ModifiedNodeCardProps {
  change: NodeChange;
}

function ModifiedNodeCard({ change }: ModifiedNodeCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="gc-diff-modified-card"
      data-testid={`diff-modified-${change.id}`}
    >
      <button
        type="button"
        className="gc-diff-modified-card__header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        data-testid={`diff-modified-toggle-${change.id}`}
      >
        <Icon name={expanded ? "chevron-down" : "chevron-right"} size={14} />
        <span className="gc-diff-modified-card__name">
          {change.name ?? change.id}
        </span>
        <span className="gc-diff-modified-card__id">{change.id}</span>
      </button>

      {expanded && change.fields && change.fields.length > 0 && (
        <div
          className="gc-diff-modified-card__fields"
          data-testid={`diff-modified-fields-${change.id}`}
        >
          {change.fields.map((f) => (
            <FieldDiffRow
              key={f.key}
              fieldKey={f.key}
              before={f.before}
              after={f.after}
            />
          ))}
        </div>
      )}

      {expanded && (!change.fields || change.fields.length === 0) && (
        <div className="gc-diff-modified-card__no-fields">—</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

interface DiffSectionProps {
  title: string;
  variant: "added" | "removed" | "modified" | "edge";
  count: number;
  children: React.ReactNode;
  testId?: string;
}

function DiffSection({ title, variant, count, children, testId }: DiffSectionProps) {
  return (
    <section
      className={`gc-diff-section gc-diff-section--${variant}`}
      data-testid={testId}
    >
      <h3 className="gc-diff-section__title">
        {title}
        <span className="gc-diff-section__count">{count}</span>
      </h3>
      <div className="gc-diff-section__body">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function WorkflowDiffView({
  graphId,
  versions,
  initialVersionA,
  initialVersionB,
}: WorkflowDiffViewProps) {
  const { t } = useTranslation();
  const { toast } = useToast();

  const versionOptions: SelectOption<string>[] = versions.map((v) => ({
    value: String(v.version),
    label: v.label ?? `v${v.version}`,
  }));

  const defaultA = initialVersionA !== undefined
    ? String(initialVersionA)
    : versionOptions[0]?.value ?? "";
  const defaultB = initialVersionB !== undefined
    ? String(initialVersionB)
    : versionOptions[1]?.value ?? "";

  const [versionA, setVersionA] = useState<string>(defaultA);
  const [versionB, setVersionB] = useState<string>(defaultB);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);

  const loadDiff = useCallback(
    (a: string, b: string) => {
      if (!a || !b || a === b) return;
      setLoading(true);
      setDiff(null);
      fetchDiff(graphId, Number(a), Number(b))
        .then((d) => setDiff(d))
        .catch((e: unknown) => {
          if (e instanceof Error && e.name === "NotFound") {
            toast.warning(t("app.workflows.versioning.diffNotFound"));
          } else {
            toast.error(t("app.workflows.versioning.diffLoadError"));
          }
        })
        .finally(() => setLoading(false));
    },
    [graphId, toast, t],
  );

  useEffect(() => {
    loadDiff(versionA, versionB);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleVersionAChange = (v: string) => {
    setVersionA(v);
    loadDiff(v, versionB);
  };

  const handleVersionBChange = (v: string) => {
    setVersionB(v);
    loadDiff(versionA, v);
  };

  return (
    <div className="gc-diff-view" data-testid="diff-view">
      <header className="gc-diff-view__header">
        <div className="gc-diff-view__selector-group">
          <label className="gc-diff-view__selector-label">
            {t("app.workflows.versioning.diffCompare")}
          </label>
          <Select<string>
            value={versionA}
            onValueChange={handleVersionAChange}
            options={versionOptions}
            placeholder={t("app.workflows.versioning.diffSelectVersion")}
            aria-label={t("app.workflows.versioning.diffCompare")}
            data-testid="diff-select-a"
          />
        </div>
        <Icon name="arrow-right" size={16} />
        <div className="gc-diff-view__selector-group">
          <label className="gc-diff-view__selector-label">
            {t("app.workflows.versioning.diffAgainst")}
          </label>
          <Select<string>
            value={versionB}
            onValueChange={handleVersionBChange}
            options={versionOptions}
            placeholder={t("app.workflows.versioning.diffSelectVersion")}
            aria-label={t("app.workflows.versioning.diffAgainst")}
            data-testid="diff-select-b"
          />
        </div>
      </header>

      {loading && (
        <div className="gc-diff-view__loading" data-testid="diff-loading">
          {t("app.workflows.versioning.loading")}
        </div>
      )}

      {!loading && diff && (
        <div className="gc-diff-view__body">
          <DiffSection
            title={t("app.workflows.versioning.diffNodesAdded")}
            variant="added"
            count={diff.nodesAdded.length}
            testId="diff-section-added"
          >
            {diff.nodesAdded.length === 0 ? (
              <span className="gc-diff-section__empty">—</span>
            ) : (
              diff.nodesAdded.map((n) => (
                <div
                  key={n.id}
                  className="gc-diff-node-added"
                  data-testid={`diff-added-${n.id}`}
                >
                  <Icon name="plus" size={12} />
                  {n.name ?? n.id}
                </div>
              ))
            )}
          </DiffSection>

          <DiffSection
            title={t("app.workflows.versioning.diffNodesRemoved")}
            variant="removed"
            count={diff.nodesRemoved.length}
            testId="diff-section-removed"
          >
            {diff.nodesRemoved.length === 0 ? (
              <span className="gc-diff-section__empty">—</span>
            ) : (
              diff.nodesRemoved.map((n) => (
                <div
                  key={n.id}
                  className="gc-diff-node-removed"
                  data-testid={`diff-removed-${n.id}`}
                >
                  <Icon name="minus" size={12} />
                  {n.name ?? n.id}
                </div>
              ))
            )}
          </DiffSection>

          <DiffSection
            title={t("app.workflows.versioning.diffNodesModified")}
            variant="modified"
            count={diff.nodesModified.length}
            testId="diff-section-modified"
          >
            {diff.nodesModified.length === 0 ? (
              <span className="gc-diff-section__empty">—</span>
            ) : (
              diff.nodesModified.map((c) => (
                <ModifiedNodeCard key={c.id} change={c} />
              ))
            )}
          </DiffSection>

          <DiffSection
            title={t("app.workflows.versioning.diffEdges")}
            variant="edge"
            count={diff.edgesAdded.length + diff.edgesRemoved.length}
            testId="diff-section-edges"
          >
            {diff.edgesAdded.length === 0 && diff.edgesRemoved.length === 0 ? (
              <span className="gc-diff-section__empty">—</span>
            ) : (
              <>
                {diff.edgesAdded.map((e) => (
                  <div
                    key={e.id}
                    className="gc-diff-edge-added"
                    data-testid={`diff-edge-added-${e.id}`}
                  >
                    <Icon name="plus" size={12} />
                    {e.description}
                  </div>
                ))}
                {diff.edgesRemoved.map((e) => (
                  <div
                    key={e.id}
                    className="gc-diff-edge-removed"
                    data-testid={`diff-edge-removed-${e.id}`}
                  >
                    <Icon name="minus" size={12} />
                    {e.description}
                  </div>
                ))}
              </>
            )}
          </DiffSection>
        </div>
      )}

      {!loading && !diff && (
        <div className="gc-diff-view__empty" data-testid="diff-empty">
          {t("app.workflows.versioning.diffEmpty")}
        </div>
      )}
    </div>
  );
}
