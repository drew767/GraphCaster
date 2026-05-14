// Copyright GraphCaster. All Rights Reserved.

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Tabs, type TabItem } from "../../ui/Tabs/Tabs";

export type AiAgentSubTabId = "main" | "tool" | "memory" | "model";

export interface NdvAiAgentProps {
  nodeId: string;
  /** Default tab body (parameters / NDV body content). */
  body: ReactNode;
  /** Optional sub-connection panels — when omitted, a placeholder is rendered. */
  toolPanel?: ReactNode;
  memoryPanel?: ReactNode;
  modelPanel?: ReactNode;
  defaultTab?: AiAgentSubTabId;
  onTabChange?: (id: AiAgentSubTabId) => void;
  "data-testid"?: string;
}

function Placeholder({ label }: { label: string }) {
  return (
    <div className="gc-ndv-ai-agent__placeholder" data-testid={`ai-agent-empty-${label}`}>
      {label}
    </div>
  );
}

export function NdvAiAgent({
  nodeId,
  body,
  toolPanel,
  memoryPanel,
  modelPanel,
  defaultTab = "main",
  onTabChange,
  "data-testid": testId,
}: NdvAiAgentProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<AiAgentSubTabId>(defaultTab);

  const items: TabItem[] = [
    {
      id: "main",
      label: t("ndv.aiAgent.tab.main"),
      content: body,
    },
    {
      id: "tool",
      label: t("ndv.aiAgent.tab.tool"),
      icon: "wrench",
      content:
        toolPanel ?? <Placeholder label={t("ndv.aiAgent.empty.tool")} />,
    },
    {
      id: "memory",
      label: t("ndv.aiAgent.tab.memory"),
      icon: "database",
      content:
        memoryPanel ?? <Placeholder label={t("ndv.aiAgent.empty.memory")} />,
    },
    {
      id: "model",
      label: t("ndv.aiAgent.tab.model"),
      icon: "brain",
      content:
        modelPanel ?? <Placeholder label={t("ndv.aiAgent.empty.model")} />,
    },
  ];

  return (
    <div
      className="gc-ndv-ai-agent"
      data-nodeid={nodeId}
      data-testid={testId ?? "ndv-ai-agent"}
    >
      <Tabs
        items={items}
        value={activeTab}
        onValueChange={(id) => {
          const next = id as AiAgentSubTabId;
          setActiveTab(next);
          onTabChange?.(next);
        }}
        variant="underline"
        size="small"
      />
    </div>
  );
}

export function isAiAgentNodeType(type: string): boolean {
  return type === "agent" || type === "llm_agent";
}
