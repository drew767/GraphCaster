// Copyright GraphCaster. All Rights Reserved.

import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import {
  Bot,
  BrainCircuit,
  FileText,
  Hash,
  Link as LinkIcon,
  Package,
  Wrench,
} from "lucide-react";
import { memo, type ComponentType } from "react";
import { useTranslation } from "react-i18next";

import "./AiEdge.css";

export type AiEdgeConnectionType =
  | "ai_tool"
  | "ai_memory"
  | "ai_languageModel"
  | "ai_outputParser"
  | "ai_embedding"
  | "ai_chain"
  | "ai_document";

type IconType = ComponentType<any>;

type AiEdgeMeta = {
  icon: IconType;
  labelKey: string;
  cssKey: string;
};

const AI_EDGE_META: Partial<Record<AiEdgeConnectionType, AiEdgeMeta>> = {
  ai_tool: { icon: Wrench, labelKey: "app.canvas.edge.label.tool", cssKey: "ai-tool" },
  ai_memory: { icon: BrainCircuit, labelKey: "app.canvas.edge.label.memory", cssKey: "ai-memory" },
  ai_languageModel: {
    icon: Bot,
    labelKey: "app.canvas.edge.label.model",
    cssKey: "ai-language-model",
  },
  ai_outputParser: {
    icon: Package,
    labelKey: "app.canvas.edge.label.parser",
    cssKey: "ai-output-parser",
  },
  ai_embedding: { icon: Hash, labelKey: "app.canvas.edge.label.embedding", cssKey: "ai-embedding" },
  ai_chain: { icon: LinkIcon, labelKey: "app.canvas.edge.label.chain", cssKey: "ai-chain" },
  ai_document: { icon: FileText, labelKey: "app.canvas.edge.label.document", cssKey: "ai-document" },
};

function readEdgeType(data: unknown): AiEdgeConnectionType | null {
  if (data == null || typeof data !== "object" || Array.isArray(data)) return null;
  const t = (data as { type?: unknown }).type;
  if (typeof t !== "string") return null;
  if (t in AI_EDGE_META) return t as AiEdgeConnectionType;
  return null;
}

export const AiEdge = memo(function AiEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
  markerEnd,
  markerStart,
  interactionWidth,
}: EdgeProps) {
  const { t } = useTranslation();

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const edgeType = readEdgeType(data);
  const meta = edgeType ? AI_EDGE_META[edgeType] : undefined;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={style}
        markerEnd={markerEnd}
        markerStart={markerStart}
        interactionWidth={interactionWidth}
      />
      {meta ? (
        <EdgeLabelRenderer>
          <div
            data-testid={`ai-edge-label-${edgeType}`}
            className={`gc-ai-edge__label gc-ai-edge__label--${meta.cssKey}`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              backgroundColor: `color-mix(in srgb, var(--color--edge-${meta.cssKey}) 12%, transparent)`,
              borderColor: `var(--color--edge-${meta.cssKey})`,
              color: `var(--color--edge-${meta.cssKey})`,
            }}
          >
            <meta.icon size={12} aria-hidden={true} />
            <span className="gc-ai-edge__label-text">{t(meta.labelKey)}</span>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
});

AiEdge.displayName = "AiEdge";
