// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { buildWebhookUrl, fetchBrokerConfig } from "./brokerConfig";
import type { GraphDocumentJson } from "../../graph/types";

interface WebhookEntry {
  graphId: string;
  nodeId: string;
  path: string;
  method: string;
  url: string;
  disabled: boolean;
}

interface Props {
  graphDocument: GraphDocumentJson | null;
  onDisableToggle?: (nodeId: string, disabled: boolean) => void;
}

function extractWebhooks(doc: GraphDocumentJson, publicUrl: string): WebhookEntry[] {
  const graphId = (doc.meta as Record<string, unknown> | undefined)?.graphId;
  const gid = typeof graphId === "string" ? graphId : "";
  const disabledTriggers: string[] = Array.isArray(
    (doc.meta as Record<string, unknown> | undefined)?.disabledTriggers,
  )
    ? ((doc.meta as Record<string, unknown>).disabledTriggers as string[])
    : [];

  return (doc.nodes ?? [])
    .filter((n) => n.type === "trigger_webhook")
    .map((n) => {
      const d = (n.data ?? {}) as Record<string, unknown>;
      const path = typeof d.path === "string" ? d.path : "/";
      const method = typeof d.method === "string" ? d.method : "POST";
      return {
        graphId: gid,
        nodeId: n.id,
        path,
        method,
        url: buildWebhookUrl(publicUrl, path),
        disabled: disabledTriggers.includes(n.id),
      };
    });
}

export function ActiveWebhooksPanel({ graphDocument, onDisableToggle }: Props) {
  const { t } = useTranslation();
  const [publicUrl, setPublicUrl] = useState("");

  useEffect(() => {
    void fetchBrokerConfig().then((cfg) => setPublicUrl(cfg.publicUrl));
  }, []);

  if (!graphDocument) return null;

  const entries = extractWebhooks(graphDocument, publicUrl);
  if (entries.length === 0) return null;

  return (
    <section className="gc-active-webhooks" data-testid="gc-active-webhooks-panel">
      <h3 className="gc-inspector-k" style={{ margin: "8px 0 4px" }}>
        {t("app.inspector.webhookActiveHeading")}
      </h3>
      <table className="gc-webhooks-table" style={{ width: "100%", fontSize: "0.85em", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "2px 4px" }}>{t("app.inspector.webhookPath")}</th>
            <th style={{ textAlign: "left", padding: "2px 4px" }}>{t("app.inspector.webhookMethod")}</th>
            <th style={{ textAlign: "left", padding: "2px 4px" }}>{t("app.inspector.webhookUrl")}</th>
            <th style={{ textAlign: "center", padding: "2px 4px" }}>{t("app.inspector.webhookDisableTrigger")}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.nodeId} data-testid={`gc-webhook-row-${entry.nodeId}`}>
              <td style={{ padding: "2px 4px" }}>{entry.path}</td>
              <td style={{ padding: "2px 4px" }}>{entry.method}</td>
              <td style={{ padding: "2px 4px", wordBreak: "break-all" }}>
                <a href={entry.url} target="_blank" rel="noopener noreferrer">
                  {entry.url}
                </a>
              </td>
              <td style={{ textAlign: "center", padding: "2px 4px" }}>
                <label>
                  <input
                    type="checkbox"
                    checked={entry.disabled}
                    onChange={(ev) => onDisableToggle?.(entry.nodeId, ev.target.checked)}
                    aria-label={t("app.inspector.webhookDisableTrigger")}
                  />
                </label>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
