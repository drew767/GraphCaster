// Copyright GraphCaster. All Rights Reserved.

import { useTranslation } from "react-i18next";

import type { GraphDocumentJson } from "../../graph/types";
import { isPlainObject } from "../../graph/inspectorValidation";
import { runSessionAppendLine } from "../../run/runSessionStore";
import {
  getStepCacheDirtySnapshot,
  markStepCacheDirtyTransitive,
} from "../../run/stepCacheDirtyStore";

export type StepCacheInspectorProps = {
  nodeId: string;
  raw: Record<string, unknown>;
  runLocked: boolean;
  graphDocument: GraphDocumentJson;
  getDocumentForStepCacheDirty?: () => GraphDocumentJson;
  onApplyNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  onMarkStepCacheDirtyTransitive?: (doc: GraphDocumentJson, seeds: readonly string[]) => void;
  /**
   * When true the "Mark dirty" action button is suppressed (the rag-index variant in
   * the original monolith renders only the toggle + hint, without the button).
   */
  hideMarkDirtyButton?: boolean;
};

export function StepCacheInspector({
  nodeId,
  raw,
  runLocked,
  graphDocument,
  getDocumentForStepCacheDirty,
  onApplyNodeData,
  onMarkStepCacheDirtyTransitive,
  hideMarkDirtyButton = false,
}: StepCacheInspectorProps) {
  const { t } = useTranslation();
  const stepCacheChecked = isPlainObject(raw) && raw.stepCache === true;

  const onMarkDirtyClick = () => {
    const doc = getDocumentForStepCacheDirty?.() ?? graphDocument;
    const before = new Set(getStepCacheDirtySnapshot().ids);
    const mark =
      onMarkStepCacheDirtyTransitive ??
      ((d: GraphDocumentJson, s: readonly string[]) => markStepCacheDirtyTransitive(d, s));
    mark(doc, [nodeId]);
    const snap = getStepCacheDirtySnapshot();
    const added = snap.ids.filter((id) => !before.has(id));
    runSessionAppendLine(
      `[host] step-cache dirty +${added.length} [${added.join(",")}] → queue ${snap.ids.length}: ${snap.ids.join(",")}`,
    );
  };

  return (
    <div className="gc-inspector-pin">
      <div className="gc-inspector-row gc-inspector-row--field">
        <span className="gc-inspector-k">{t("app.inspector.stepCacheHeading")}</span>
        <label className="gc-inspector-pin-toggle">
          <input
            type="checkbox"
            disabled={runLocked}
            checked={stepCacheChecked}
            onChange={(ev) => {
              const base = isPlainObject(raw) ? { ...raw } : {};
              if (ev.target.checked) {
                base.stepCache = true;
              } else {
                delete base.stepCache;
              }
              onApplyNodeData(nodeId, base);
            }}
          />
          <span>{t("app.inspector.stepCacheEnabled")}</span>
        </label>
      </div>
      {hideMarkDirtyButton ? null : (
        <div className="gc-inspector-pin-actions">
          <button
            type="button"
            className="gc-btn gc-inspector-apply"
            disabled={runLocked}
            onClick={onMarkDirtyClick}
          >
            {t("app.inspector.stepCacheMarkDirty")}
          </button>
        </div>
      )}
      <p className="gc-inspector-edge-hint">{t("app.inspector.stepCacheHint")}</p>
    </div>
  );
}
