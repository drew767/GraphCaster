// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useRef, useState, type DragEvent } from "react";
import type { EditorView } from "@codemirror/view";

import { Input } from "../../ui/Input/Input";
import { InlineExpressionEditor } from "../expression/InlineExpressionEditor";
import type { AvailableNode, AvailableVariable } from "../expression/expressionAutocomplete";
import {
  MAPPING_MIME,
  buildExpressionFromMapping,
  type DraggableKeyPayload,
} from "../input/DraggableKey";
import { FieldModeToggle } from "./FieldModeToggle";
import { ExpressionResultStrip } from "./ExpressionResultStrip";
import { useNdvStore, type FieldMode } from "../useNdvStore";
import type { EvaluationContext } from "../expression/evaluator";
import "./ParameterInput.css";

export interface ParameterInputProps {
  paramKey: string;
  value: string;
  onChange: (next: string) => void;
  /** Placeholder text shown in fixed-mode input. */
  placeholder?: string;
  disabled?: boolean;
  availableNodes?: AvailableNode[];
  availableVariables?: AvailableVariable[];
  /** Evaluation context used by hover-resolve and the result strip. */
  evaluationContext?: EvaluationContext;
  /** Initial mode if user has not yet toggled. Defaults to "fixed". */
  defaultMode?: FieldMode;
  /** Hide the result strip (still keeps hover-resolve). */
  hideResultStrip?: boolean;
}

function parseMappingPayload(event: DragEvent<HTMLElement>): DraggableKeyPayload | null {
  const raw = event.dataTransfer.getData(MAPPING_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DraggableKeyPayload;
    if (
      parsed &&
      typeof parsed.path === "string" &&
      typeof parsed.sourceNodeName === "string"
    ) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

function hasMappingType(event: DragEvent<HTMLElement>): boolean {
  const types = Array.from(event.dataTransfer.types ?? []);
  return types.includes(MAPPING_MIME);
}

export function ParameterInput({
  paramKey,
  value,
  onChange,
  placeholder,
  disabled,
  availableNodes = [],
  availableVariables = [],
  evaluationContext,
  defaultMode = "fixed",
  hideResultStrip = false,
}: ParameterInputProps) {
  const mode = useNdvStore((s) => s.fieldMode[paramKey] ?? defaultMode);
  const setFieldMode = useNdvStore((s) => s.setFieldMode);
  const editorViewRef = useRef<EditorView | null>(null);
  const [dropActive, setDropActive] = useState(false);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasMappingType(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropActive(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDropActive(false);
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!hasMappingType(event)) return;
      event.preventDefault();
      setDropActive(false);
      const payload = parseMappingPayload(event);
      if (!payload) return;
      const expression = buildExpressionFromMapping(payload);

      if (mode === "expression") {
        const view = editorViewRef.current;
        if (view) {
          const from = view.state.selection.main.from;
          const to = view.state.selection.main.to;
          view.dispatch({ changes: { from, to, insert: expression } });
          return;
        }
      }
      onChange(expression);
      if (mode !== "expression") {
        setFieldMode(paramKey, "expression");
      }
    },
    [mode, onChange, paramKey, setFieldMode],
  );

  const wrapperClasses = [
    "gc-param-input",
    `gc-param-input--${mode}`,
    dropActive ? "gc-param--drop-target" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="gc-param-input-wrap" data-testid={`parameter-input-${paramKey}`}>
      <div
        className={wrapperClasses}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        data-drop-active={dropActive ? "true" : "false"}
      >
        {mode === "expression" ? (
          <InlineExpressionEditor
            value={value}
            onChange={onChange}
            availableNodes={availableNodes}
            availableVariables={availableVariables}
            placeholder={placeholder}
            evaluationContext={evaluationContext}
            editorViewRef={editorViewRef}
            readOnly={disabled}
          />
        ) : (
          <Input
            id={`param-${paramKey}`}
            value={value}
            placeholder={placeholder}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
        <FieldModeToggle paramKey={paramKey} defaultMode={defaultMode} />
      </div>
      {!hideResultStrip && (
        <ExpressionResultStrip
          value={value}
          context={evaluationContext ?? {}}
        />
      )}
    </div>
  );
}
