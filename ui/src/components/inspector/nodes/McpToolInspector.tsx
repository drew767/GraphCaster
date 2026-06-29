// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { GraphDocumentJson, GraphNodeJson } from "../../../graph/types";
import { isPlainObject } from "../../../graph/inspectorValidation";

export type McpToolInspectorProps = {
  node: GraphNodeJson;
  graphDocument: GraphDocumentJson;
  runLocked: boolean;
  workspaceLinked: boolean;
  onApplyNodeData: (nodeId: string, data: Record<string, unknown>) => void;
};

export function McpToolInspector({ node, runLocked, onApplyNodeData }: McpToolInspectorProps) {
  const { t } = useTranslation();
  const raw: Record<string, unknown> = isPlainObject(node.data) ? node.data : {};

  const [mcpTransport, setMcpTransport] = useState<"stdio" | "streamable_http">("stdio");
  const [mcpToolName, setMcpToolName] = useState("");
  const [mcpTimeoutSec, setMcpTimeoutSec] = useState("60");
  const [mcpCommand, setMcpCommand] = useState("");
  const [mcpServerUrl, setMcpServerUrl] = useState("");
  const [mcpAllowInsecure, setMcpAllowInsecure] = useState(false);
  const [mcpBearerKey, setMcpBearerKey] = useState("");
  const [mcpArgsJson, setMcpArgsJson] = useState("{}");

  useEffect(() => {
    const r = raw;
    setMcpTransport(r.transport === "streamable_http" ? "streamable_http" : "stdio");
    setMcpToolName(typeof r.toolName === "string" ? r.toolName : "");
    const ts = r.timeoutSec;
    setMcpTimeoutSec(
      typeof ts === "number" && Number.isFinite(ts)
        ? String(ts)
        : typeof ts === "string" && ts.trim() !== ""
          ? ts.trim()
          : "60",
    );
    setMcpCommand(typeof r.command === "string" ? r.command : "");
    setMcpServerUrl(typeof r.serverUrl === "string" ? r.serverUrl : "");
    setMcpAllowInsecure(r.allowInsecureLocalhost === true);
    setMcpBearerKey(typeof r.bearerEnvKey === "string" ? r.bearerEnvKey : "");
    const ar = r.arguments;
    setMcpArgsJson(
      JSON.stringify(ar != null && typeof ar === "object" && !Array.isArray(ar) ? ar : {}, null, 2),
    );
  }, [node.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyFields = () => {
    if (runLocked) {
      return;
    }
    let argsObj: Record<string, unknown>;
    try {
      const p = JSON.parse(mcpArgsJson);
      if (!isPlainObject(p)) {
        throw new Error("not_object");
      }
      argsObj = p;
    } catch {
      window.alert(t("app.inspector.mcpArgumentsInvalid"));
      return;
    }
    const toN = Number.parseFloat(mcpTimeoutSec);
    const timeoutSec = Number.isFinite(toN) ? Math.min(600, Math.max(1, toN)) : 60;
    const base = isPlainObject(raw) ? { ...raw } : {};
    const next: Record<string, unknown> = {
      ...base,
      transport: mcpTransport,
      toolName: mcpToolName.trim(),
      timeoutSec,
      arguments: argsObj,
      allowInsecureLocalhost: mcpAllowInsecure,
    };
    if (mcpCommand.trim() !== "") {
      next.command = mcpCommand;
    } else {
      delete next.command;
    }
    if (mcpServerUrl.trim() !== "") {
      next.serverUrl = mcpServerUrl;
    } else {
      delete next.serverUrl;
    }
    if (mcpBearerKey.trim() !== "") {
      next.bearerEnvKey = mcpBearerKey.trim();
    } else {
      delete next.bearerEnvKey;
    }
    onApplyNodeData(node.id, next);
  };

  return (
    <div className="gc-inspector-mcp">
      <div className="gc-inspector-row gc-inspector-row--field">
        <label className="gc-inspector-k" htmlFor="gc-sub-mcp-transport">
          {t("app.inspector.mcpTransport")}
        </label>
        <select
          id="gc-sub-mcp-transport"
          className="gc-inspector-condition-input"
          disabled={runLocked}
          value={mcpTransport}
          onChange={(ev) => {
            setMcpTransport(ev.target.value === "streamable_http" ? "streamable_http" : "stdio");
          }}
        >
          <option value="stdio">{t("app.inspector.mcpTransportStdio")}</option>
          <option value="streamable_http">{t("app.inspector.mcpTransportHttp")}</option>
        </select>
      </div>
      <div className="gc-inspector-row gc-inspector-row--field">
        <label className="gc-inspector-k" htmlFor="gc-sub-mcp-tool">
          {t("app.inspector.mcpToolName")}
        </label>
        <input
          id="gc-sub-mcp-tool"
          className="gc-inspector-condition-input"
          disabled={runLocked}
          value={mcpToolName}
          onChange={(ev) => {
            setMcpToolName(ev.target.value);
          }}
        />
      </div>
      <div className="gc-inspector-row gc-inspector-row--field">
        <label className="gc-inspector-k" htmlFor="gc-sub-mcp-to">
          {t("app.inspector.mcpTimeoutSec")}
        </label>
        <input
          id="gc-sub-mcp-to"
          type="text"
          inputMode="decimal"
          className="gc-inspector-condition-input"
          disabled={runLocked}
          value={mcpTimeoutSec}
          onChange={(ev) => {
            setMcpTimeoutSec(ev.target.value);
          }}
        />
      </div>
      {mcpTransport === "stdio" ? (
        <div className="gc-inspector-row gc-inspector-row--field">
          <label className="gc-inspector-k" htmlFor="gc-sub-mcp-cmd">
            {t("app.inspector.mcpCommand")}
          </label>
          <input
            id="gc-sub-mcp-cmd"
            className="gc-inspector-condition-input"
            disabled={runLocked}
            value={mcpCommand}
            onChange={(ev) => {
              setMcpCommand(ev.target.value);
            }}
          />
        </div>
      ) : (
        <>
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-k" htmlFor="gc-sub-mcp-url">
              {t("app.inspector.mcpServerUrl")}
            </label>
            <input
              id="gc-sub-mcp-url"
              className="gc-inspector-condition-input"
              disabled={runLocked}
              value={mcpServerUrl}
              onChange={(ev) => {
                setMcpServerUrl(ev.target.value);
              }}
            />
          </div>
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-k" htmlFor="gc-sub-mcp-bearer">
              {t("app.inspector.mcpBearerEnvKey")}
            </label>
            <input
              id="gc-sub-mcp-bearer"
              className="gc-inspector-condition-input"
              disabled={runLocked}
              value={mcpBearerKey}
              onChange={(ev) => {
                setMcpBearerKey(ev.target.value);
              }}
            />
          </div>
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-k" htmlFor="gc-sub-mcp-insecure">
              {t("app.inspector.mcpAllowInsecureLocalhost")}
            </label>
            <input
              id="gc-sub-mcp-insecure"
              type="checkbox"
              disabled={runLocked}
              checked={mcpAllowInsecure}
              onChange={(ev) => {
                setMcpAllowInsecure(ev.target.checked);
              }}
            />
          </div>
        </>
      )}
      <div className="gc-inspector-row gc-inspector-row--field">
        <label className="gc-inspector-k" htmlFor="gc-sub-mcp-args">
          {t("app.inspector.mcpArgumentsJson")}
        </label>
        <textarea
          id="gc-sub-mcp-args"
          className="gc-inspector-condition-input"
          disabled={runLocked}
          rows={5}
          value={mcpArgsJson}
          onChange={(ev) => {
            setMcpArgsJson(ev.target.value);
          }}
        />
      </div>
      <button
        type="button"
        className="gc-btn gc-inspector-apply"
        disabled={runLocked}
        onClick={applyFields}
      >
        {t("app.inspector.applyMcpSettings")}
      </button>
    </div>
  );
}
