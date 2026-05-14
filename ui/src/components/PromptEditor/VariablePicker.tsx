// Copyright GraphCaster. All Rights Reserved.

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export type UpstreamNodeDef = {
  id: string;
  type: string;
  outputs: string[];
};

export type VariableDef = {
  scope: "sys" | "session" | "tenant" | "env";
  name: string;
};

type Props = {
  availableNodes: UpstreamNodeDef[];
  availableVariables?: VariableDef[];
  onInsert: (expression: string) => void;
};

export function VariablePicker({ availableNodes, availableVariables = [], onInsert }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleInsert = (expr: string) => {
    onInsert(`{{ ${expr} }}`);
    setOpen(false);
  };

  const nodesSection = availableNodes.length > 0 ? (
    <div className="gc-varpicker-section">
      <div className="gc-varpicker-section-heading">{t("app.promptEditor.fromNode")}</div>
      {availableNodes.map((node) => (
        <div key={node.id} className="gc-varpicker-node-group">
          <div className="gc-varpicker-node-label" title={node.type}>
            <span className="gc-varpicker-node-id">{node.id}</span>
            <span className="gc-varpicker-node-type"> ({node.type})</span>
          </div>
          {node.outputs.map((output) => (
            <button
              key={output}
              type="button"
              className="gc-varpicker-item"
              onClick={() => handleInsert(`$node.${node.id}.${output}`)}
            >
              {`$node.${node.id}.${output}`}
            </button>
          ))}
        </div>
      ))}
    </div>
  ) : (
    <div className="gc-varpicker-section">
      <div className="gc-varpicker-section-heading">{t("app.promptEditor.fromNode")}</div>
      <div className="gc-varpicker-empty">{t("app.promptEditor.noUpstreamNodes")}</div>
    </div>
  );

  const scopeGroups: Record<string, VariableDef[]> = {};
  for (const v of availableVariables) {
    const arr = scopeGroups[v.scope] ?? [];
    arr.push(v);
    scopeGroups[v.scope] = arr;
  }

  const variablesSection = (
    <div className="gc-varpicker-section">
      <div className="gc-varpicker-section-heading">{t("app.promptEditor.fromVariableScope")}</div>
      {Object.entries(scopeGroups).map(([scope, vars]) => (
        <div key={scope} className="gc-varpicker-node-group">
          <div className="gc-varpicker-node-label">{scope}</div>
          {vars.map((v) => (
            <button
              key={`${v.scope}.${v.name}`}
              type="button"
              className="gc-varpicker-item"
              onClick={() => handleInsert(`${v.scope}.${v.name}`)}
            >
              {`${v.scope}.${v.name}`}
            </button>
          ))}
        </div>
      ))}
      {/* Built-in sys variables */}
      <div className="gc-varpicker-node-group">
        <div className="gc-varpicker-node-label">sys</div>
        {["sys.run_id", "sys.graph_id", "sys.node_id"].map((expr) => (
          <button
            key={expr}
            type="button"
            className="gc-varpicker-item"
            onClick={() => handleInsert(expr)}
          >
            {expr}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="gc-varpicker-root">
      <button
        ref={buttonRef}
        type="button"
        className="gc-varpicker-toggle"
        title={t("app.promptEditor.insertVariable")}
        aria-label={t("app.promptEditor.insertVariable")}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        &#8801;
      </button>
      {open && (
        <div
          className="gc-varpicker-popover"
          role="dialog"
          aria-label={t("app.promptEditor.insertVariable")}
        >
          <div className="gc-varpicker-content">
            {nodesSection}
            {variablesSection}
          </div>
        </div>
      )}
    </div>
  );
}
