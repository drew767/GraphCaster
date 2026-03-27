// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import type { GraphCanvasSelection } from "./GraphCanvas";
import type { GraphDocumentJson, GraphDocumentSettingsPatch } from "../graph/types";
import { graphIdFromDocument } from "../graph/parseDocument";

type Props = {
  selection: GraphCanvasSelection | null;
  graphDocument: GraphDocumentJson;
  onApplyGraphDocumentSettings: (patch: GraphDocumentSettingsPatch) => void;
  onApplyNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  onApplyEdgeCondition: (edgeId: string, condition: string | null) => void;
  workspaceLinked: boolean;
  onOpenNestedGraph?: (targetGraphId: string) => void;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function scalarGraphRefId(v: unknown): string {
  if (typeof v === "string" && v.trim() !== "") {
    return v.trim();
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return String(v);
  }
  return "";
}

function graphRefTargetId(raw: Record<string, unknown>): string {
  const a = scalarGraphRefId(raw.targetGraphId);
  if (a !== "") {
    return a;
  }
  return scalarGraphRefId(raw.graphId);
}

function inputsOutputsFromDoc(doc: GraphDocumentJson): { inputsText: string; outputsText: string } {
  const ins = doc.inputs;
  const outs = doc.outputs;
  return {
    inputsText:
      ins === undefined ? "[]" : JSON.stringify(ins, null, 2),
    outputsText:
      outs === undefined ? "[]" : JSON.stringify(outs, null, 2),
  };
}

export function InspectorPanel({
  selection,
  graphDocument,
  onApplyGraphDocumentSettings,
  onApplyNodeData,
  onApplyEdgeCondition,
  workspaceLinked,
  onOpenNestedGraph,
}: Props) {
  const { t } = useTranslation();
  const [dataText, setDataText] = useState("{}");
  const [conditionText, setConditionText] = useState("");

  const [graphTitle, setGraphTitle] = useState("");
  const [graphAuthor, setGraphAuthor] = useState("");
  const [graphSchemaVersion, setGraphSchemaVersion] = useState("1");
  const [graphInputsText, setGraphInputsText] = useState("[]");
  const [graphOutputsText, setGraphOutputsText] = useState("[]");

  const graphDocSyncKey = useMemo(() => {
    return JSON.stringify({
      title: graphDocument.meta?.title ?? "",
      gid: graphIdFromDocument(graphDocument) ?? "",
      author: graphDocument.meta?.author ?? "",
      sv: graphDocument.schemaVersion ?? graphDocument.meta?.schemaVersion ?? 1,
      inputs: graphDocument.inputs,
      outputs: graphDocument.outputs,
    });
  }, [graphDocument]);

  useEffect(() => {
    if (selection?.kind === "node") {
      setDataText(JSON.stringify(selection.raw, null, 2));
    } else if (selection?.kind === "edge") {
      setConditionText(selection.condition ?? "");
    } else {
      setDataText("{}");
      setConditionText("");
    }
  }, [selection]);

  useEffect(() => {
    if (selection != null) {
      return;
    }
    const { inputsText, outputsText } = inputsOutputsFromDoc(graphDocument);
    setGraphTitle(graphDocument.meta?.title ?? "");
    setGraphAuthor(typeof graphDocument.meta?.author === "string" ? graphDocument.meta.author : "");
    const sv = graphDocument.schemaVersion ?? graphDocument.meta?.schemaVersion ?? 1;
    setGraphSchemaVersion(String(sv));
    setGraphInputsText(inputsText);
    setGraphOutputsText(outputsText);
  }, [selection, graphDocSyncKey]);

  const onSubmitNode = (e: FormEvent) => {
    e.preventDefault();
    if (!selection || selection.kind !== "node") {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(dataText);
    } catch {
      window.alert(t("app.inspector.dataParseError"));
      return;
    }
    if (!isPlainObject(parsed)) {
      window.alert(t("app.inspector.invalidDataJson"));
      return;
    }
    onApplyNodeData(selection.id, parsed);
  };

  const onSubmitEdge = (e: FormEvent) => {
    e.preventDefault();
    if (!selection || selection.kind !== "edge") {
      return;
    }
    const trimmed = conditionText.trim();
    onApplyEdgeCondition(selection.id, trimmed === "" ? null : trimmed);
  };

  const onSubmitGraph = (e: FormEvent) => {
    e.preventDefault();
    let inputsParsed: unknown | undefined;
    let outputsParsed: unknown | undefined;
    if (graphInputsText.trim() === "") {
      inputsParsed = undefined;
    } else {
      try {
        inputsParsed = JSON.parse(graphInputsText);
      } catch {
        window.alert(t("app.inspector.dataParseError"));
        return;
      }
    }
    if (graphOutputsText.trim() === "") {
      outputsParsed = undefined;
    } else {
      try {
        outputsParsed = JSON.parse(graphOutputsText);
      } catch {
        window.alert(t("app.inspector.dataParseError"));
        return;
      }
    }
    if (
      inputsParsed !== undefined &&
      !Array.isArray(inputsParsed) &&
      !isPlainObject(inputsParsed)
    ) {
      window.alert(t("app.inspector.graphParamsInvalidJson"));
      return;
    }
    if (
      outputsParsed !== undefined &&
      !Array.isArray(outputsParsed) &&
      !isPlainObject(outputsParsed)
    ) {
      window.alert(t("app.inspector.graphParamsInvalidJson"));
      return;
    }
    const svRaw = graphSchemaVersion.trim();
    let schemaVersion: number;
    if (svRaw === "") {
      schemaVersion = 1;
    } else {
      const n = Number.parseInt(svRaw, 10);
      if (!Number.isFinite(n)) {
        window.alert(t("app.inspector.graphSchemaInvalid"));
        return;
      }
      schemaVersion = n;
    }
    const patch: GraphDocumentSettingsPatch = {
      title: graphTitle,
      author: graphAuthor,
      schemaVersion,
      inputs: inputsParsed,
      outputs: outputsParsed,
    };
    onApplyGraphDocumentSettings(patch);
  };

  return (
    <aside className="gc-inspector">
      <h2>{t("app.inspector.heading")}</h2>
      {selection?.kind === "node" ? (
        <div className="gc-inspector-detail">
          <div className="gc-inspector-row">
            <span className="gc-inspector-k">{t("app.inspector.nodeId")}</span>
            <span className="gc-inspector-v">{selection.id}</span>
          </div>
          <div className="gc-inspector-row">
            <span className="gc-inspector-k">{t("app.inspector.nodeType")}</span>
            <span className="gc-inspector-v">{selection.graphNodeType}</span>
          </div>
          <div className="gc-inspector-row">
            <span className="gc-inspector-k">{t("app.inspector.label")}</span>
            <span className="gc-inspector-v">{selection.label}</span>
          </div>
          {selection.graphNodeType === "comment" ? (
            <p className="gc-inspector-edge-hint">{t("app.inspector.commentFrameHint")}</p>
          ) : null}
          {selection.graphNodeType === "graph_ref" ? (
            <div className="gc-inspector-graphref">
              <button
                type="button"
                className="gc-btn gc-btn-primary gc-inspector-apply"
                disabled={
                  !workspaceLinked ||
                  graphRefTargetId(selection.raw) === "" ||
                  onOpenNestedGraph == null
                }
                onClick={() => {
                  const tid = graphRefTargetId(selection.raw);
                  if (tid && onOpenNestedGraph) {
                    onOpenNestedGraph(tid);
                  }
                }}
              >
                {t("app.inspector.openGraphRef")}
              </button>
              {!workspaceLinked ? (
                <p className="gc-inspector-edge-hint">{t("app.inspector.openGraphRefNeedWorkspace")}</p>
              ) : null}
            </div>
          ) : null}
          <form className="gc-inspector-data-form" onSubmit={onSubmitNode}>
            <label className="gc-inspector-data-label" htmlFor="gc-inspector-data">
              {t("app.inspector.dataJson")}
            </label>
            <textarea
              id="gc-inspector-data"
              className="gc-inspector-data-textarea"
              value={dataText}
              onChange={(ev) => {
                setDataText(ev.target.value);
              }}
              spellCheck={false}
              autoComplete="off"
              rows={12}
            />
            <button type="submit" className="gc-btn gc-btn-primary gc-inspector-apply">
              {t("app.inspector.applyData")}
            </button>
          </form>
        </div>
      ) : selection?.kind === "edge" ? (
        <div className="gc-inspector-detail">
          <div className="gc-inspector-row">
            <span className="gc-inspector-k">{t("app.inspector.edgeId")}</span>
            <span className="gc-inspector-v">{selection.id}</span>
          </div>
          <div className="gc-inspector-row">
            <span className="gc-inspector-k">{t("app.inspector.edgeSource")}</span>
            <span className="gc-inspector-v">{selection.source}</span>
          </div>
          <div className="gc-inspector-row">
            <span className="gc-inspector-k">{t("app.inspector.edgeTarget")}</span>
            <span className="gc-inspector-v">{selection.target}</span>
          </div>
          <form className="gc-inspector-data-form" onSubmit={onSubmitEdge}>
            <label className="gc-inspector-data-label" htmlFor="gc-inspector-condition">
              {t("app.inspector.edgeCondition")}
            </label>
            <input
              id="gc-inspector-condition"
              className="gc-inspector-condition-input"
              type="text"
              value={conditionText}
              onChange={(ev) => {
                setConditionText(ev.target.value);
              }}
              spellCheck={false}
              autoComplete="off"
              placeholder={t("app.inspector.edgeConditionPlaceholder")}
            />
            <p className="gc-inspector-edge-hint">{t("app.inspector.edgeConditionHint")}</p>
            <button type="submit" className="gc-btn gc-btn-primary gc-inspector-apply">
              {t("app.inspector.applyEdgeCondition")}
            </button>
          </form>
        </div>
      ) : (
        <div className="gc-inspector-detail">
          <p className="gc-inspector-hint-line">{t("app.inspector.hint")}</p>
          <h3 className="gc-inspector-subheading">{t("app.inspector.graphSection")}</h3>
          <form className="gc-inspector-data-form" onSubmit={onSubmitGraph}>
            <label className="gc-inspector-data-label" htmlFor="gc-inspector-graph-title">
              {t("app.inspector.graphTitle")}
            </label>
            <input
              id="gc-inspector-graph-title"
              className="gc-inspector-condition-input"
              type="text"
              value={graphTitle}
              onChange={(ev) => {
                setGraphTitle(ev.target.value);
              }}
              autoComplete="off"
            />
            <span className="gc-inspector-data-label">{t("app.inspector.graphId")}</span>
            <div
              className="gc-inspector-readonly gc-inspector-mono"
              aria-label={t("app.inspector.graphId")}
            >
              {graphIdFromDocument(graphDocument) ?? "—"}
            </div>
            <label className="gc-inspector-data-label" htmlFor="gc-inspector-graph-author">
              {t("app.inspector.graphAuthor")}
            </label>
            <input
              id="gc-inspector-graph-author"
              className="gc-inspector-condition-input"
              type="text"
              value={graphAuthor}
              onChange={(ev) => {
                setGraphAuthor(ev.target.value);
              }}
              autoComplete="off"
            />
            <label className="gc-inspector-data-label" htmlFor="gc-inspector-graph-sv">
              {t("app.inspector.graphSchemaVersion")}
            </label>
            <input
              id="gc-inspector-graph-sv"
              className="gc-inspector-condition-input"
              type="text"
              inputMode="numeric"
              value={graphSchemaVersion}
              onChange={(ev) => {
                setGraphSchemaVersion(ev.target.value);
              }}
              autoComplete="off"
            />
            <label className="gc-inspector-data-label" htmlFor="gc-inspector-graph-inputs">
              {t("app.inspector.graphInputs")}
            </label>
            <textarea
              id="gc-inspector-graph-inputs"
              className="gc-inspector-data-textarea"
              value={graphInputsText}
              onChange={(ev) => {
                setGraphInputsText(ev.target.value);
              }}
              spellCheck={false}
              autoComplete="off"
              rows={6}
            />
            <p className="gc-inspector-edge-hint">{t("app.inspector.graphInputsHint")}</p>
            <label className="gc-inspector-data-label" htmlFor="gc-inspector-graph-outputs">
              {t("app.inspector.graphOutputs")}
            </label>
            <textarea
              id="gc-inspector-graph-outputs"
              className="gc-inspector-data-textarea"
              value={graphOutputsText}
              onChange={(ev) => {
                setGraphOutputsText(ev.target.value);
              }}
              spellCheck={false}
              autoComplete="off"
              rows={6}
            />
            <p className="gc-inspector-edge-hint">{t("app.inspector.graphOutputsHint")}</p>
            <button type="submit" className="gc-btn gc-btn-primary gc-inspector-apply">
              {t("app.inspector.applyGraph")}
            </button>
          </form>
        </div>
      )}
    </aside>
  );
}
