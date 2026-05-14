// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { AvatarStack } from "../../components/ui/Avatar/Avatar";
import {
  usePresenceStore,
  type PresenceUser,
} from "../../app/stores/presenceStore";

export interface PresenceAvatarsProps {
  workflowId: string;
  /** Max avatars to render (default 8). */
  max?: number;
}

/**
 * Presence avatars chip for the workflow header right slot.
 * Pulls active editors from `presenceStore` when present; otherwise falls
 * back to `localStorage.gc.presence.<workflowId>`.
 */
export function PresenceAvatars({
  workflowId,
  max = 8,
}: PresenceAvatarsProps) {
  const { t } = useTranslation();
  const stored = usePresenceStore((s) => s.byWorkflow[workflowId]);
  const loadFromLocalStorage = usePresenceStore((s) => s.loadFromLocalStorage);

  const [fallback, setFallback] = useState<PresenceUser[]>([]);

  useEffect(() => {
    if (stored && stored.length > 0) return;
    setFallback(loadFromLocalStorage(workflowId));
  }, [workflowId, stored, loadFromLocalStorage]);

  const source: PresenceUser[] = stored && stored.length > 0 ? stored : fallback;
  if (!source || source.length === 0) {
    return null;
  }

  const limited = source.slice(0, max);
  return (
    <span
      className="gc-workflow-header__presence"
      data-testid="workflow-header-presence"
      aria-label={t("presence.activeEditors", "Active editors: {{count}}", {
        count: limited.length,
      })}
    >
      <AvatarStack
        avatars={limited.map((u) => ({
          fallback: u.name,
          color: u.color,
          alt: u.name,
        }))}
        size="small"
        max={max}
      />
    </span>
  );
}
