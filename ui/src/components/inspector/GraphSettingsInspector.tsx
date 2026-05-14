// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import type { GraphDocumentJson, GraphDocumentSettingsPatch } from "../../graph/types";
import { graphIdFromDocument } from "../../graph/parseDocument";
import {
  isPlainObject,
  inputsOutputsFromDoc,
} from "../../graph/inspectorValidation";
import {
  type AppMessagePresentation,
  presentationForInspectorJsonSyntaxError,
  presentationForInspectorSimple,
} from "../../graph/openGraphErrorPresentation";

export type GraphSettingsInspectorProps = {
  graphDocument: GraphDocumentJson;
  runLocked: boolean;
  onApplyGraphDocumentSettings: (patch: GraphDocumentSettingsPatch) => void;
  onUserMessage?: (presentation: AppMessagePresentation) => void;
};

export function GraphSettingsInspector({
  graphDocument,
  runLocked,
  onApplyGraphDocumentSettings,
  onUserMessage,
}: GraphSettingsInspectorProps) {
  const { t } = useTranslation();

  const memoizedGraphId = useMemo(
    () => graphIdFromDocument(graphDocument) ?? "",
    [graphDocument],
  );

  const graphDocSyncKey = useMemo(() => {
    return JSON.stringify({
      title: graphDocument.meta?.title ?? "",
      gid: memoizedGraphId,
      author: graphDocument.meta?.author ?? "",
      sv: graphDocument.schemaVersion ?? graphDocument.meta?.schemaVersion ?? 1,
      inputs: graphDocument.inputs,
      outputs: graphDocument.outputs,
    });
  }, [graphDocument, memoizedGraphId]);

  const [graphTitle, setGraphTitle] = useState("");
  const [graphAuthor, setGraphAuthor] = useState("");
  const [graphSchemaVersion, setGraphSchemaVersion] = useState("1");
  const [graphInputsText, setGraphInputsText] = useState("[]");
  const [graphOutputsText, setGraphOutputsText] = useState("[]");

  useEffect(() => {
    const { inputsText, outputsText } = inputsOutputsFromDoc(graphDocument);
    setGraphTitle(graphDocument.meta?.title ?? "");
    setGraphAuthor(typeof graphDocument.meta?.author === "string" ? graphDocument.meta.author : "");
    const sv = graphDocument.schemaVersion ?? graphDocument.meta?.schemaVersion ?? 1;
    setGraphSchemaVersion(String(sv));
    setGraphInputsText(inputsText);
    setGraphOutputsText(outputsText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphDocSyncKey]);

  const showInspectorError = (presentation: AppMessagePresentation, legacyAlertKey: string) => {
    if (onUserMessage) {
      onUserMessage(presentation);
    } else {
      window.alert(t(legacyAlertKey));
    }
  };

  const onSubmitGraph = (e: FormEvent) => {
    e.preventDefault();
    if (runLocked) {
      return;
    }
    let inputsParsed: unknown | undefined;
    let outputsParsed: unknown | undefined;
    if (graphInputsText.trim() === "") {
      inputsParsed = undefined;
    } else {
      try {
        inputsParsed = JSON.parse(graphInputsText);
      } catch (err) {
        showInspectorError(
          presentationForInspectorJsonSyntaxError(t, err),
          "app.inspector.dataParseError",
        );
        return;
      }
    }
    if (graphOutputsText.trim() === "") {
      outputsParsed = undefined;
    } else {
      try {
        outputsParsed = JSON.parse(graphOutputsText);
      } catch (err) {
        showInspectorError(
          presentationForInspectorJsonSyntaxError(t, err),
          "app.inspector.dataParseError",
        );
        return;
      }
    }
    if (
      inputsParsed !== undefined &&
      !Array.isArray(inputsParsed) &&
      !isPlainObject(inputsParsed)
    ) {
      showInspectorError(
        presentationForInspectorSimple(t, "app.inspector.graphParamsInvalidJson"),
        "app.inspector.graphParamsInvalidJson",
      );
      return;
    }
    if (
      outputsParsed !== undefined &&
      !Array.isArray(outputsParsed) &&
      !isPlainObject(outputsParsed)
    ) {
      showInspectorError(
        presentationForInspectorSimple(t, "app.inspector.graphParamsInvalidJson"),
        "app.inspector.graphParamsInvalidJson",
      );
      return;
    }
    const svRaw = graphSchemaVersion.trim();
    let schemaVersion: number;
    if (svRaw === "") {
      schemaVersion = 1;
    } else {
      const n = Number.parseInt(svRaw, 10);
      if (!Number.isFinite(n)) {
        showInspectorError(
          presentationForInspectorSimple(t, "app.inspector.graphSchemaInvalid"),
          "app.inspector.graphSchemaInvalid",
        );
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
          readOnly={runLocked}
          autoComplete="off"
        />
        <span className="gc-inspector-data-label">{t("app.inspector.graphId")}</span>
        <div
          className="gc-inspector-readonly gc-inspector-mono"
          aria-label={t("app.inspector.graphId")}
        >
          {memoizedGraphId === "" ? "—" : memoizedGraphId}
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
          readOnly={runLocked}
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
          readOnly={runLocked}
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
          readOnly={runLocked}
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
          readOnly={runLocked}
          spellCheck={false}
          autoComplete="off"
          rows={6}
        />
        <p className="gc-inspector-edge-hint">{t("app.inspector.graphOutputsHint")}</p>
        <button
          type="submit"
          className="gc-btn gc-btn-primary gc-inspector-apply"
          disabled={runLocked}
        >
          {t("app.inspector.applyGraph")}
        </button>
      </form>
    </div>
  );
}
