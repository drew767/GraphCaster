// Copyright GraphCaster. All Rights Reserved.

import { useTranslation } from "react-i18next";
import type { NodeStep } from "./traceTree";
import { NodeStepCard } from "./NodeStepCard";

type Props = {
  steps: NodeStep[];
  onReplay?: (nodeId: string) => void;
  onNavigateToNode?: (nodeId: string) => void;
};

export function EventTimeline({ steps, onReplay, onNavigateToNode }: Props) {
  const { t } = useTranslation();

  if (steps.length === 0) {
    return (
      <div className="gc-ri-empty" data-testid="gc-ri-timeline-empty">
        {t("app.runInspector.timelineEmpty")}
      </div>
    );
  }

  return (
    <div className="gc-ri-timeline" data-testid="gc-ri-timeline">
      {steps.map((step) => (
        <NodeStepCard
          key={step.nodeId}
          step={step}
          onReplay={onReplay}
          onNavigate={onNavigateToNode}
        />
      ))}
    </div>
  );
}
