// Copyright GraphCaster. All Rights Reserved.

import { useEffect } from "react";
import { useReactFlow, type Edge, type Node } from "@xyflow/react";
import { useTranslation } from "react-i18next";

import { useToast } from "../../toast/ToastProvider";
import { isTextEditingTarget } from "../../lib/isTextEditingTarget";

export const GC_CLIPBOARD_VERSION = 1;

export type GcCanvasClipboardPayload = {
  nodes: Node[];
  edges: Edge[];
  gcVersion: typeof GC_CLIPBOARD_VERSION;
};

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "gc-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
}

export function buildClipboardPayload(
  nodes: ReadonlyArray<Node>,
  edges: ReadonlyArray<Edge>,
): GcCanvasClipboardPayload {
  const selectedNodes = nodes.filter((n) => n.selected === true);
  const idset = new Set(selectedNodes.map((n) => n.id));
  const selectedEdges = edges.filter((e) => idset.has(e.source) && idset.has(e.target));
  return {
    nodes: selectedNodes.map((n) => cloneJson(n)),
    edges: selectedEdges.map((e) => cloneJson(e)),
    gcVersion: GC_CLIPBOARD_VERSION,
  };
}

export function parseClipboardPayload(raw: string): GcCanvasClipboardPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") {
    return null;
  }
  const o = parsed as Record<string, unknown>;
  if (o.gcVersion !== GC_CLIPBOARD_VERSION) {
    return null;
  }
  if (!Array.isArray(o.nodes) || !Array.isArray(o.edges)) {
    return null;
  }
  return {
    nodes: o.nodes as Node[],
    edges: o.edges as Edge[],
    gcVersion: GC_CLIPBOARD_VERSION,
  };
}

export type RemappedPayload = {
  nodes: Node[];
  edges: Edge[];
};

export function remapPayloadForInsert(
  payload: GcCanvasClipboardPayload,
  offset: { x: number; y: number },
  makeId: () => string = newId,
): RemappedPayload {
  const idMap = new Map<string, string>();
  for (const n of payload.nodes) {
    idMap.set(n.id, makeId());
  }
  const newNodes: Node[] = payload.nodes.map((n) => {
    const next = cloneJson(n);
    next.id = idMap.get(n.id) ?? makeId();
    const px = typeof next.position?.x === "number" ? next.position.x : 0;
    const py = typeof next.position?.y === "number" ? next.position.y : 0;
    next.position = { x: px + offset.x, y: py + offset.y };
    next.selected = true;
    if (typeof next.parentId === "string" && next.parentId !== "") {
      const mapped = idMap.get(next.parentId);
      if (mapped !== undefined) {
        next.parentId = mapped;
      } else {
        delete next.parentId;
      }
    }
    return next;
  });
  const newEdges: Edge[] = [];
  for (const e of payload.edges) {
    const s = idMap.get(e.source);
    const t = idMap.get(e.target);
    if (s === undefined || t === undefined) {
      continue;
    }
    const next = cloneJson(e);
    next.id = makeId();
    next.source = s;
    next.target = t;
    next.selected = true;
    newEdges.push(next);
  }
  return { nodes: newNodes, edges: newEdges };
}

function cloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export type UseCanvasClipboardOptions = {
  /** Optional override for the paste/duplicate offset (defaults to 40,40). */
  pasteOffset?: { x: number; y: number };
  /** Skip handling when true. */
  disabled?: boolean;
};

const DEFAULT_OFFSET = { x: 40, y: 40 } as const;

export function useCanvasClipboard(options: UseCanvasClipboardOptions = {}): void {
  const { getNodes, getEdges, setNodes, setEdges } = useReactFlow();
  const { toast } = useToast();
  const { t } = useTranslation();
  const disabled = options.disabled === true;
  const offset = options.pasteOffset ?? DEFAULT_OFFSET;

  useEffect(() => {
    if (disabled) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      if (!ctrlOrMeta) {
        return;
      }
      if (e.altKey) {
        return;
      }
      if (isTextEditingTarget(e.target ?? document.activeElement)) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "c") {
        const payload = buildClipboardPayload(getNodes(), getEdges());
        if (payload.nodes.length === 0) {
          return;
        }
        e.preventDefault();
        void copyToClipboard(payload).then((ok) => {
          if (ok) {
            toast.success(
              t("app.canvas.clipboard.copied", { count: payload.nodes.length }),
            );
          } else {
            toast.error(t("app.canvas.clipboard.copyFailed"));
          }
        });
        return;
      }
      if (key === "v") {
        e.preventDefault();
        void readFromClipboard().then((raw) => {
          if (raw == null) {
            return;
          }
          const payload = parseClipboardPayload(raw);
          if (payload == null || payload.nodes.length === 0) {
            return;
          }
          const remapped = remapPayloadForInsert(payload, offset);
          insertIntoCanvas(remapped, setNodes, setEdges);
          toast.success(
            t("app.canvas.clipboard.pasted", { count: remapped.nodes.length }),
          );
        });
        return;
      }
      if (key === "d") {
        const payload = buildClipboardPayload(getNodes(), getEdges());
        if (payload.nodes.length === 0) {
          return;
        }
        e.preventDefault();
        const remapped = remapPayloadForInsert(payload, offset);
        insertIntoCanvas(remapped, setNodes, setEdges);
        toast.success(
          t("app.canvas.clipboard.duplicated", { count: remapped.nodes.length }),
        );
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [disabled, getNodes, getEdges, setNodes, setEdges, toast, t, offset]);
}

async function copyToClipboard(payload: GcCanvasClipboardPayload): Promise<boolean> {
  const text = JSON.stringify(payload);
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  return false;
}

async function readFromClipboard(): Promise<string | null> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
      const v = await navigator.clipboard.readText();
      return typeof v === "string" ? v : null;
    }
  } catch {
    /* clipboard read denied — return null */
  }
  return null;
}

function insertIntoCanvas(
  remapped: RemappedPayload,
  setNodes: (updater: (nodes: Node[]) => Node[]) => void,
  setEdges: (updater: (edges: Edge[]) => Edge[]) => void,
): void {
  setNodes((prev) => {
    const cleared = prev.map((n) => (n.selected ? { ...n, selected: false } : n));
    return [...cleared, ...remapped.nodes];
  });
  setEdges((prev) => {
    const cleared = prev.map((e) => (e.selected ? { ...e, selected: false } : e));
    return [...cleared, ...remapped.edges];
  });
}
