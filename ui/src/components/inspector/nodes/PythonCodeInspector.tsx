// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { GraphDocumentJson, GraphNodeJson } from "../../../graph/types";
import { isPlainObject } from "../../../graph/inspectorValidation";

export type PythonCodeInspectorProps = {
  node: GraphNodeJson;
  graphDocument: GraphDocumentJson;
  runLocked: boolean;
  workspaceLinked: boolean;
  onApplyNodeData: (nodeId: string, data: Record<string, unknown>) => void;
};

export function PythonCodeInspector({ node, runLocked, onApplyNodeData }: PythonCodeInspectorProps) {
  const { t } = useTranslation();
  const raw: Record<string, unknown> = isPlainObject(node.data) ? node.data : {};

  const [pyCode, setPyCode] = useState("");
  const [pyTimeoutSec, setPyTimeoutSec] = useState("30");

  useEffect(() => {
    const r = raw;
    setPyCode(typeof r.code === "string" ? r.code : "");
    const pts = r.timeoutSec;
    setPyTimeoutSec(
      typeof pts === "number" && Number.isFinite(pts)
        ? String(pts)
        : typeof pts === "string" && pts.trim() !== ""
          ? pts.trim()
          : "30",
    );
  }, [node.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyFields = () => {
    if (runLocked) {
      return;
    }
    const toN = Number.parseFloat(pyTimeoutSec);
    const timeoutSec = Number.isFinite(toN) ? Math.min(3600, Math.max(0.5, toN)) : 30;
    const base = isPlainObject(raw) ? { ...raw } : {};
    const next: Record<string, unknown> = {
      ...base,
      title: typeof base.title === "string" && base.title.trim() !== "" ? base.title : "Python code",
      code: pyCode,
      timeoutSec,
    };
    onApplyNodeData(node.id, next);
  };

  return (
    <div className="gc-inspector-mcp">
      <div className="gc-inspector-row gc-inspector-row--field">
        <label className="gc-inspector-k" htmlFor="gc-sub-py-code">
          {t("app.inspector.pythonCodeEditorLabel")}
        </label>
        <textarea
          id="gc-sub-py-code"
          className="gc-inspector-condition-input"
          disabled={runLocked}
          rows={12}
          value={pyCode}
          onChange={(ev) => {
            setPyCode(ev.target.value);
          }}
        />
      </div>
      <div className="gc-inspector-row gc-inspector-row--field">
        <label className="gc-inspector-k" htmlFor="gc-sub-py-to">
          {t("app.inspector.pythonCodeTimeoutSec")}
        </label>
        <input
          id="gc-sub-py-to"
          type="text"
          inputMode="decimal"
          className="gc-inspector-condition-input"
          disabled={runLocked}
          value={pyTimeoutSec}
          onChange={(ev) => {
            setPyTimeoutSec(ev.target.value);
          }}
        />
      </div>
      <button
        type="button"
        className="gc-btn gc-inspector-apply"
        disabled={runLocked}
        onClick={applyFields}
      >
        {t("app.inspector.applyPythonCodeSettings")}
      </button>
    </div>
  );
}
