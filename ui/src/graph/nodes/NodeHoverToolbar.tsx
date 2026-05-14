// Copyright GraphCaster. All Rights Reserved.

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "../../components/ui/Icon/Icon";
import { Tooltip } from "../../components/ui/Tooltip/Tooltip";
import "./NodeHoverToolbar.css";

const SHOW_DELAY_MS = 80;
const HIDE_DELAY_MS = 200;

export interface NodeHoverToolbarProps {
  nodeId: string;
  isMuted: boolean;
  visible: boolean;
  connectionDragActive?: boolean;
  onExecute?: (nodeId: string) => void;
  onToggleDisable?: (nodeId: string) => void;
  onTogglePin?: (nodeId: string) => void;
  onDuplicate?: (nodeId: string) => void;
  onOpenSettings?: (nodeId: string) => void;
  onDelete?: (nodeId: string) => void;
}

function NodeHoverToolbarInner({
  nodeId,
  isMuted,
  visible,
  connectionDragActive = false,
  onExecute,
  onToggleDisable,
  onTogglePin,
  onDuplicate,
  onOpenSettings,
  onDelete,
}: NodeHoverToolbarProps) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  const showTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (showTimer.current != null) {
      window.clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    if (hideTimer.current != null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  useEffect(() => {
    if (connectionDragActive) {
      clearTimers();
      setShown(false);
      return;
    }
    if (visible) {
      if (hideTimer.current != null) {
        window.clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
      if (!shown && showTimer.current == null) {
        showTimer.current = window.setTimeout(() => {
          setShown(true);
          showTimer.current = null;
        }, SHOW_DELAY_MS);
      }
    } else {
      if (showTimer.current != null) {
        window.clearTimeout(showTimer.current);
        showTimer.current = null;
      }
      if (shown && hideTimer.current == null) {
        hideTimer.current = window.setTimeout(() => {
          setShown(false);
          hideTimer.current = null;
        }, HIDE_DELAY_MS);
      }
    }
    return () => {
      /* timers cleared on next effect run or unmount */
    };
  }, [visible, shown, connectionDragActive, clearTimers]);

  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  if (connectionDragActive || !shown) {
    return null;
  }

  const handleExecute = () => onExecute?.(nodeId);
  const handleToggleDisable = () => onToggleDisable?.(nodeId);
  const handleTogglePin = () => onTogglePin?.(nodeId);
  const handleDuplicate = () => onDuplicate?.(nodeId);
  const handleOpenSettings = () => onOpenSettings?.(nodeId);
  const handleDelete = () => onDelete?.(nodeId);

  const disableLabel = isMuted
    ? t("canvas.node.toolbar.enable")
    : t("canvas.node.toolbar.disable");

  return (
    <div
      role="toolbar"
      aria-label={t("canvas.node.toolbar.label")}
      className="gc-node-hover-toolbar"
      data-testid="node-hover-toolbar"
      data-node-id={nodeId}
    >
      <Tooltip content={t("canvas.node.toolbar.execute")} side="top">
        <button
          type="button"
          className="gc-node-hover-toolbar__btn"
          onClick={handleExecute}
          aria-label={t("canvas.node.toolbar.execute")}
        >
          <Icon name="circle-play" size={16} />
        </button>
      </Tooltip>

      <Tooltip content={disableLabel} side="top">
        <button
          type="button"
          className="gc-node-hover-toolbar__btn"
          onClick={handleToggleDisable}
          aria-label={disableLabel}
          aria-pressed={isMuted}
        >
          <Icon name="power" size={16} />
        </button>
      </Tooltip>

      <Tooltip content={t("canvas.node.toolbar.pin")} side="top">
        <button
          type="button"
          className="gc-node-hover-toolbar__btn"
          onClick={handleTogglePin}
          aria-label={t("canvas.node.toolbar.pin")}
        >
          <Icon name="pin" size={16} />
        </button>
      </Tooltip>

      <Tooltip content={t("canvas.node.toolbar.duplicate")} side="top">
        <button
          type="button"
          className="gc-node-hover-toolbar__btn"
          onClick={handleDuplicate}
          aria-label={t("canvas.node.toolbar.duplicate")}
        >
          <Icon name="copy" size={16} />
        </button>
      </Tooltip>

      <Tooltip content={t("canvas.node.toolbar.settings")} side="top">
        <button
          type="button"
          className="gc-node-hover-toolbar__btn"
          onClick={handleOpenSettings}
          aria-label={t("canvas.node.toolbar.settings")}
        >
          <Icon name="settings" size={16} />
        </button>
      </Tooltip>

      <Tooltip content={t("canvas.node.toolbar.delete")} side="top">
        <button
          type="button"
          className="gc-node-hover-toolbar__btn gc-node-hover-toolbar__btn--danger"
          onClick={handleDelete}
          aria-label={t("canvas.node.toolbar.delete")}
        >
          <Icon name="trash-2" size={16} />
        </button>
      </Tooltip>
    </div>
  );
}

export const NodeHoverToolbar = memo(NodeHoverToolbarInner);
NodeHoverToolbar.displayName = "NodeHoverToolbar";
