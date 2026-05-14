// Copyright GraphCaster. All Rights Reserved.

import { useState } from "react";

import { Icon } from "../../ui/Icon/Icon";
import { DraggableKey } from "../input/DraggableKey";

type SchemaType = "string" | "number" | "boolean" | "object" | "array" | "null";

function detectType(value: unknown): SchemaType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "object":
      return "object";
    default:
      return "null";
  }
}

function previewValue(value: unknown, type: SchemaType): string {
  if (type === "null") return "null";
  if (type === "string") {
    const s = value as string;
    return s.length > 40 ? `"${s.slice(0, 40)}…"` : `"${s}"`;
  }
  if (type === "number" || type === "boolean") return String(value);
  if (type === "array") {
    const arr = value as unknown[];
    return `[${arr.length}]`;
  }
  if (type === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    return `{${keys.length}}`;
  }
  return "";
}

export interface SchemaViewProps {
  data: unknown;
  emptyLabel?: string;
  /** When set, leaf rows become draggable for data mapping. */
  sourceNodeName?: string;
}

interface SchemaRowProps {
  name: string;
  value: unknown;
  depth: number;
  path: string;
  sourceNodeName?: string;
}

function SchemaRow({ name, value, depth, path, sourceNodeName }: SchemaRowProps) {
  const type = detectType(value);
  const expandable = type === "object" || type === "array";
  const [expanded, setExpanded] = useState<boolean>(depth < 1);

  const preview = previewValue(value, type);

  const entries: Array<[string, unknown]> = expandable
    ? type === "array"
      ? (value as unknown[]).map((v, i) => [String(i), v] as [string, unknown])
      : Object.entries(value as Record<string, unknown>)
    : [];

  const keyLabel = <span className="gc-schema__key">{name}</span>;
  const draggable = !expandable && !!sourceNodeName && path.length > 0;

  return (
    <div className="gc-schema__node" style={{ paddingLeft: depth * 12 }}>
      <div
        className={[
          "gc-schema__row",
          expandable ? "gc-schema__row--expandable" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={expandable ? () => setExpanded((v) => !v) : undefined}
        role={expandable ? "button" : undefined}
        tabIndex={expandable ? 0 : -1}
        onKeyDown={
          expandable
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setExpanded((v) => !v);
                }
              }
            : undefined
        }
        data-testid={`schema-row-${name}`}
      >
        {expandable ? (
          <span className="gc-schema__chevron" aria-hidden="true">
            <Icon
              name={expanded ? "chevron-down" : "chevron-right"}
              size={12}
            />
          </span>
        ) : (
          <span className="gc-schema__chevron-spacer" aria-hidden="true" />
        )}
        {draggable ? (
          <DraggableKey path={path} sourceNodeName={sourceNodeName!}>
            {keyLabel}
          </DraggableKey>
        ) : (
          keyLabel
        )}
        <span className={`gc-schema__type gc-schema__type--${type}`}>{type}</span>
        <span className="gc-schema__preview">{preview}</span>
      </div>
      {expandable && expanded && entries.length > 0 && (
        <div className="gc-schema__children" role="group">
          {entries.map(([k, v]) => (
            <SchemaRow
              key={k}
              name={k}
              value={v}
              depth={depth + 1}
              path={path ? `${path}.${k}` : k}
              sourceNodeName={sourceNodeName}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function SchemaView({ data, emptyLabel, sourceNodeName }: SchemaViewProps) {
  if (data === undefined || data === null) {
    return <div className="gc-schema__empty">{emptyLabel ?? "—"}</div>;
  }

  const type = detectType(data);
  if (type !== "object" && type !== "array") {
    return (
      <div className="gc-schema">
        <SchemaRow
          name="value"
          value={data}
          depth={0}
          path="value"
          sourceNodeName={sourceNodeName}
        />
      </div>
    );
  }

  const entries: Array<[string, unknown]> =
    type === "array"
      ? (data as unknown[]).map((v, i) => [String(i), v] as [string, unknown])
      : Object.entries(data as Record<string, unknown>);

  if (entries.length === 0) {
    return <div className="gc-schema__empty">{emptyLabel ?? "—"}</div>;
  }

  return (
    <div className="gc-schema" data-testid="schema-view">
      {entries.map(([k, v]) => (
        <SchemaRow
          key={k}
          name={k}
          value={v}
          depth={0}
          path={k}
          sourceNodeName={sourceNodeName}
        />
      ))}
    </div>
  );
}
