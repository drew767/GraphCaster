// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { GraphDocumentJson, GraphNodeJson } from "../../../graph/types";
import {
  buildGcCursorAgentPayload,
  cursorAgentUiValidationKey,
  parseExtraArgsJson,
  type GcCursorAgentCwdBase,
} from "../../../graph/cursorAgentPreset";
import { isPlainObject } from "../../../graph/inspectorValidation";

export type TaskInspectorProps = {
  node: GraphNodeJson;
  graphDocument: GraphDocumentJson;
  runLocked: boolean;
  workspaceLinked: boolean;
  onApplyNodeData: (nodeId: string, data: Record<string, unknown>) => void;
};

export function TaskInspector({ node, runLocked, onApplyNodeData }: TaskInspectorProps) {
  const { t } = useTranslation();
  const raw: Record<string, unknown> = isPlainObject(node.data) ? node.data : {};

  const [caEnabled, setCaEnabled] = useState(false);
  const [caPrompt, setCaPrompt] = useState("");
  const [caPromptFile, setCaPromptFile] = useState("");
  const [caCwdBase, setCaCwdBase] = useState<GcCursorAgentCwdBase>("workspace_root");
  const [caCwdRelative, setCaCwdRelative] = useState("");
  const [caModel, setCaModel] = useState("");
  const [caOutputFormat, setCaOutputFormat] = useState("");
  const [caExtraArgsJson, setCaExtraArgsJson] = useState("");
  const [caPrintMode, setCaPrintMode] = useState(true);
  const [caApplyFileChanges, setCaApplyFileChanges] = useState(false);

  useEffect(() => {
    const gca = isPlainObject(raw.gcCursorAgent) ? raw.gcCursorAgent : null;
    setCaEnabled(gca != null);
    if (gca != null) {
      setCaPrompt(typeof gca.prompt === "string" ? gca.prompt : "");
      setCaPromptFile(typeof gca.promptFile === "string" ? gca.promptFile : "");
      const cb = gca.cwdBase;
      setCaCwdBase(
        cb === "graphs_root" || cb === "artifact_dir"
          ? (cb as GcCursorAgentCwdBase)
          : "workspace_root",
      );
      setCaCwdRelative(typeof gca.cwdRelative === "string" ? gca.cwdRelative : "");
      setCaModel(typeof gca.model === "string" ? gca.model : "");
      setCaOutputFormat(typeof gca.outputFormat === "string" ? gca.outputFormat : "");
      setCaExtraArgsJson(Array.isArray(gca.extraArgs) ? JSON.stringify(gca.extraArgs) : "");
      setCaPrintMode(gca.printMode !== false);
      setCaApplyFileChanges(gca.applyFileChanges === true);
    } else {
      setCaPrompt("");
      setCaPromptFile("");
      setCaCwdBase("workspace_root");
      setCaCwdRelative("");
      setCaModel("");
      setCaOutputFormat("");
      setCaExtraArgsJson("");
      setCaPrintMode(true);
      setCaApplyFileChanges(false);
    }
  }, [node.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyCursorAgent = () => {
    if (runLocked) {
      return;
    }
    let next: Record<string, unknown> = { ...raw };
    if (caEnabled) {
      const vKey = cursorAgentUiValidationKey({ prompt: caPrompt, promptFile: caPromptFile });
      if (vKey != null) {
        window.alert(t(vKey));
        return;
      }
      try {
        parseExtraArgsJson(caExtraArgsJson);
      } catch {
        window.alert(t("app.inspector.cursorAgentExtraArgsInvalid"));
        return;
      }
      next = {
        ...next,
        gcCursorAgent: buildGcCursorAgentPayload({
          prompt: caPrompt,
          promptFile: caPromptFile,
          cwdBase: caCwdBase,
          cwdRelative: caCwdRelative,
          model: caModel,
          outputFormat: caOutputFormat,
          extraArgsJson: caExtraArgsJson,
          printMode: caPrintMode,
          applyFileChanges: caApplyFileChanges,
        }),
      };
    } else {
      const { gcCursorAgent: _rm, ...rest } = next;
      next = { ...rest };
    }
    onApplyNodeData(node.id, next);
  };

  return (
    <div className="gc-inspector-pin">
      <div className="gc-inspector-row gc-inspector-row--field">
        <span className="gc-inspector-k">{t("app.inspector.cursorAgentHeading")}</span>
        <label className="gc-inspector-pin-toggle">
          <input
            type="checkbox"
            disabled={runLocked}
            checked={caEnabled}
            onChange={(ev) => {
              setCaEnabled(ev.target.checked);
            }}
          />
          <span>{t("app.inspector.cursorAgentEnabled")}</span>
        </label>
      </div>
      {caEnabled ? (
        <>
          <label className="gc-inspector-data-label" htmlFor="gc-ca-prompt">
            {t("app.inspector.cursorAgentPrompt")}
          </label>
          <textarea
            id="gc-ca-prompt"
            className="gc-inspector-data-textarea"
            rows={4}
            disabled={runLocked}
            value={caPrompt}
            onChange={(ev) => {
              setCaPrompt(ev.target.value);
            }}
          />
          <label className="gc-inspector-data-label" htmlFor="gc-ca-prompt-file">
            {t("app.inspector.cursorAgentPromptFile")}
          </label>
          <input
            id="gc-ca-prompt-file"
            className="gc-inspector-condition-input"
            type="text"
            disabled={runLocked}
            value={caPromptFile}
            onChange={(ev) => {
              setCaPromptFile(ev.target.value);
            }}
          />
          <label className="gc-inspector-data-label" htmlFor="gc-ca-cwd-base-sub">
            {t("app.inspector.cursorAgentCwdBase")}
          </label>
          <select
            id="gc-ca-cwd-base-sub"
            className="gc-inspector-condition-input"
            disabled={runLocked}
            value={caCwdBase}
            onChange={(ev) => {
              const v = ev.target.value;
              setCaCwdBase(v === "graphs_root" || v === "artifact_dir" ? v : "workspace_root");
            }}
          >
            <option value="workspace_root">{t("app.inspector.cursorAgentCwdWorkspace")}</option>
            <option value="graphs_root">{t("app.inspector.cursorAgentCwdGraphs")}</option>
            <option value="artifact_dir">{t("app.inspector.cursorAgentCwdArtifact")}</option>
          </select>
          <label className="gc-inspector-data-label" htmlFor="gc-ca-cwd-rel-sub">
            {t("app.inspector.cursorAgentCwdRelative")}
          </label>
          <input
            id="gc-ca-cwd-rel-sub"
            className="gc-inspector-condition-input"
            type="text"
            disabled={runLocked}
            value={caCwdRelative}
            onChange={(ev) => {
              setCaCwdRelative(ev.target.value);
            }}
          />
          <label className="gc-inspector-data-label" htmlFor="gc-ca-model-sub">
            {t("app.inspector.cursorAgentModel")}
          </label>
          <input
            id="gc-ca-model-sub"
            className="gc-inspector-condition-input"
            type="text"
            disabled={runLocked}
            value={caModel}
            onChange={(ev) => {
              setCaModel(ev.target.value);
            }}
          />
          <label className="gc-inspector-data-label" htmlFor="gc-ca-outfmt-sub">
            {t("app.inspector.cursorAgentOutputFormat")}
          </label>
          <input
            id="gc-ca-outfmt-sub"
            className="gc-inspector-condition-input"
            type="text"
            disabled={runLocked}
            placeholder="text"
            value={caOutputFormat}
            onChange={(ev) => {
              setCaOutputFormat(ev.target.value);
            }}
          />
          <label className="gc-inspector-data-label" htmlFor="gc-ca-extra-sub">
            {t("app.inspector.cursorAgentExtraArgs")}
          </label>
          <textarea
            id="gc-ca-extra-sub"
            className="gc-inspector-data-textarea"
            rows={2}
            disabled={runLocked}
            value={caExtraArgsJson}
            onChange={(ev) => {
              setCaExtraArgsJson(ev.target.value);
            }}
          />
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-pin-toggle">
              <input
                type="checkbox"
                disabled={runLocked}
                checked={caPrintMode}
                onChange={(ev) => {
                  setCaPrintMode(ev.target.checked);
                }}
              />
              <span>{t("app.inspector.cursorAgentPrintMode")}</span>
            </label>
          </div>
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-pin-toggle">
              <input
                type="checkbox"
                disabled={runLocked}
                checked={caApplyFileChanges}
                onChange={(ev) => {
                  setCaApplyFileChanges(ev.target.checked);
                }}
              />
              <span>{t("app.inspector.cursorAgentApplyFiles")}</span>
            </label>
          </div>
          <button
            type="button"
            className="gc-btn gc-inspector-apply"
            disabled={runLocked}
            onClick={applyCursorAgent}
          >
            {t("app.inspector.applyData")}
          </button>
        </>
      ) : null}
    </div>
  );
}
