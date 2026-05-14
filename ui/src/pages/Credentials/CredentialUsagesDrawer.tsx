// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, Dialog, Icon, Spinner } from "../../components/ui";
import { workflowsApi, type WorkflowSummary } from "../../lib/workflowsApi";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CredentialUsage {
  workflowId: string;
  workflowName: string;
  nodeIds: string[];
}

export interface CredentialUsagesDrawerProps {
  open: boolean;
  credentialId: string;
  credentialName: string;
  onClose: () => void;
  loadUsages?: (credentialId: string) => Promise<CredentialUsage[]>;
}

// ---------------------------------------------------------------------------
// Default usage loader: tries REST endpoint, falls back to client-side scan.
// ---------------------------------------------------------------------------

interface NodeWithCreds {
  id?: string;
  name?: string;
  credentials?: Record<string, unknown>;
}

interface WorkflowWithNodes extends WorkflowSummary {
  nodes?: NodeWithCreds[];
}

function nodeMatchesCredential(node: NodeWithCreds | undefined, credentialId: string): boolean {
  if (!node || typeof node !== "object") return false;
  const creds = node.credentials;
  if (!creds || typeof creds !== "object") return false;
  for (const value of Object.values(creds)) {
    if (typeof value === "string" && value === credentialId) return true;
    if (value && typeof value === "object") {
      const ref = (value as { id?: unknown }).id;
      if (typeof ref === "string" && ref === credentialId) return true;
    }
  }
  return false;
}

export async function defaultLoadUsages(credentialId: string): Promise<CredentialUsage[]> {
  try {
    const resp = await fetch(`/api/v1/credentials/${encodeURIComponent(credentialId)}/usages`);
    if (resp.ok) {
      const json = (await resp.json()) as
        | CredentialUsage[]
        | { usages?: CredentialUsage[] };
      if (Array.isArray(json)) return json;
      if (json && Array.isArray(json.usages)) return json.usages;
    }
  } catch {
    /* fall through to client-side scan */
  }

  try {
    const workflows = (await workflowsApi.list()) as WorkflowWithNodes[];
    const out: CredentialUsage[] = [];
    for (const wf of workflows) {
      const nodes = Array.isArray(wf.nodes) ? wf.nodes : [];
      const matchingIds: string[] = [];
      for (const node of nodes) {
        if (nodeMatchesCredential(node, credentialId)) {
          const nid = typeof node?.id === "string" ? node.id : node?.name;
          if (typeof nid === "string") matchingIds.push(nid);
        }
      }
      if (matchingIds.length > 0) {
        out.push({ workflowId: wf.id, workflowName: wf.name, nodeIds: matchingIds });
      }
    }
    return out;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CredentialUsagesDrawer({
  open,
  credentialId,
  credentialName,
  onClose,
  loadUsages = defaultLoadUsages,
}: CredentialUsagesDrawerProps) {
  const { t } = useTranslation();
  const [usages, setUsages] = useState<CredentialUsage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    loadUsages(credentialId)
      .then((items) => {
        if (!cancelled) setUsages(items);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, credentialId, loadUsages]);

  const footer = (
    <Button variant="solid" type="button" onClick={onClose}>
      {t("credentials.usages.close")}
    </Button>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      size="medium"
      title={t("credentials.usages.drawerTitle", { name: credentialName })}
      footer={footer}
    >
      <div className="gc-cred-usages-drawer" data-testid="credential-usages-drawer">
        {loading && (
          <div className="gc-cred-usages-drawer__loading" data-testid="credential-usages-loading">
            <Spinner size={16} />
            <span className="gc-cred-usages-drawer__muted">
              {t("credentials.usages.loading")}
            </span>
          </div>
        )}
        {!loading && error && (
          <p className="gc-cred-usages-drawer__muted" data-testid="credential-usages-error">
            {t("credentials.usages.error")}
          </p>
        )}
        {!loading && !error && usages.length === 0 && (
          <p className="gc-cred-usages-drawer__muted" data-testid="credential-usages-empty">
            {t("credentials.usages.empty")}
          </p>
        )}
        {!loading && !error && usages.length > 0 && (
          <ul
            className="gc-cred-usages-drawer__list"
            data-testid="credential-usages-list"
          >
            {usages.map((u) => (
              <li
                key={u.workflowId}
                className="gc-cred-usages-drawer__item"
                data-testid={`credential-usages-item-${u.workflowId}`}
              >
                <div className="gc-cred-usages-drawer__item-meta">
                  <a
                    className="gc-cred-usages-drawer__workflow-link"
                    href={`/workflow/${u.workflowId}`}
                    data-testid={`credential-usages-link-${u.workflowId}`}
                  >
                    <Icon name="git-branch" size={14} aria-hidden />
                    <span>{u.workflowName}</span>
                  </a>
                  <span className="gc-cred-usages-drawer__muted gc-cred-usages-drawer__nodes">
                    {t("credentials.usages.nodesLabel", {
                      nodes: u.nodeIds.join(", "),
                    })}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
