// Copyright GraphCaster. All Rights Reserved.

import { NodeResizer, useReactFlow, type NodeProps } from "@xyflow/react";
import { memo, useCallback, useEffect, useRef } from "react";

import type { GcNodeData } from "../../graph/toReactFlow";
import { StickyNoteToolbar, type StickyColor, STICKY_COLORS } from "./StickyNoteToolbar";

export type StickyNoteData = GcNodeData & {
  text?: string;
  color?: StickyColor;
};

export const STICKY_DEFAULT_WIDTH = 200;
export const STICKY_DEFAULT_HEIGHT = 150;
export const STICKY_MIN_WIDTH = 120;
export const STICKY_MIN_HEIGHT = 80;
export const STICKY_MAX_WIDTH = 800;
export const STICKY_MAX_HEIGHT = 600;

function isStickyColor(v: unknown): v is StickyColor {
  return typeof v === "string" && (STICKY_COLORS as readonly string[]).includes(v);
}

function StickyNoteNodeInner(props: NodeProps) {
  const data = props.data as StickyNoteData | undefined;
  const text = typeof data?.text === "string" ? data.text : "";
  const color: StickyColor = isStickyColor(data?.color) ? (data!.color as StickyColor) : "yellow";

  const { setNodes } = useReactFlow();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const autoExpand = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, []);

  useEffect(() => {
    autoExpand();
  }, [text, autoExpand]);

  const updateData = useCallback(
    (patch: Partial<StickyNoteData>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === props.id
            ? { ...n, data: { ...(n.data as StickyNoteData), ...patch } }
            : n,
        ),
      );
    },
    [props.id, setNodes],
  );

  const onTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateData({ text: e.target.value });
    },
    [updateData],
  );

  const onColorChange = useCallback(
    (next: StickyColor) => {
      updateData({ color: next });
    },
    [updateData],
  );

  const background = `var(--gc-sticky-bg-${color})`;

  return (
    <div
      className={`gc-sticky-note${props.selected ? " gc-sticky-note--selected" : ""}`}
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: background,
        borderRadius: 6,
        padding: 8,
        boxSizing: "border-box",
        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.12)",
        position: "relative",
      }}
      data-testid="sticky-note-node"
      data-sticky-color={color}
    >
      <NodeResizer
        isVisible={props.selected}
        minWidth={STICKY_MIN_WIDTH}
        minHeight={STICKY_MIN_HEIGHT}
        maxWidth={STICKY_MAX_WIDTH}
        maxHeight={STICKY_MAX_HEIGHT}
        lineClassName="gc-sticky-note-resize-line"
        handleClassName="gc-sticky-note-resize-handle"
      />
      {props.selected ? (
        <StickyNoteToolbar selected={color} onSelect={onColorChange} />
      ) : null}
      <textarea
        ref={textareaRef}
        className="gc-sticky-note__textarea"
        data-testid="sticky-note-textarea"
        value={text}
        onChange={onTextChange}
        onInput={autoExpand}
        style={{
          width: "100%",
          height: "100%",
          minHeight: "100%",
          background: "transparent",
          border: "none",
          outline: "none",
          resize: "none",
          font: "inherit",
          color: "inherit",
          padding: 0,
        }}
      />
    </div>
  );
}

export const StickyNoteNode = memo(StickyNoteNodeInner);
StickyNoteNode.displayName = "StickyNoteNode";
