// Copyright GraphCaster. All Rights Reserved.

import React, { useMemo } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { Breadcrumbs } from "../../../components/ui/Breadcrumbs/Breadcrumbs";
import { InlineTextEdit } from "../../../components/ui/InlineTextEdit/InlineTextEdit";
import { Button } from "../../../components/ui/Button/Button";
import { Badge } from "../../../components/ui/Badge/Badge";
import { Icon } from "../../../components/ui/Icon/Icon";
import type { IconName } from "../../../components/ui/Icon/registry";
import { DropdownMenu } from "../../../components/ui/DropdownMenu/DropdownMenu";
import { Popover } from "../../../components/ui/Popover/Popover";
import { EmptyState } from "../../../components/ui/EmptyState/EmptyState";
import { formatRelative } from "../../../lib/time";
import { useNotificationsStore, type Notification } from "../../stores/notificationsStore";
import { useUIStore } from "../../stores/uiStore";
import { useHeaderSlotStore } from "../../stores/headerSlotStore";
import {
  AiAssistantPanel,
  AiAssistantTrigger,
} from "../AiAssistant/AiAssistantPanel";
import { PUBLISH_WORKFLOW_MODAL_KEY } from "../../../components/workflows/PublishWorkflowModal";
import { VERSIONS_MODAL_KEY } from "../../../components/workflows/WorkflowVersionsModal";

import type { BreadcrumbItem } from "../../../components/ui/Breadcrumbs/Breadcrumbs";
import "./AppHeader.css";

export interface AppHeaderProps {
  workflowId?: string;
  workflowName?: string;
  onWorkflowNameChange?: (name: string) => void;
  isDirty?: boolean;
  isRunning?: boolean;
  onSave?: () => void;
  onRun?: () => void;
  onStop?: () => void;
  notificationsCount?: number;
  workflowVersion?: number | null;
}

type RouteContext = "home" | "workflow" | "settings" | "other";

function useRouteContext(): RouteContext {
  const { pathname } = useLocation();
  if (pathname.startsWith("/workflow/")) return "workflow";
  if (pathname.startsWith("/home/") || pathname === "/home") return "home";
  if (pathname.startsWith("/settings")) return "settings";
  return "other";
}

function useBreadcrumbs(context: RouteContext): BreadcrumbItem[] {
  const { t } = useTranslation();
  const { pathname } = useLocation();

  return useMemo(() => {
    if (context === "home") {
      if (pathname.includes("/executions")) {
        return [
          { label: t("app.header.breadcrumbs.home"), href: "/home/workflows" },
          { label: t("app.header.breadcrumbs.executions") },
        ];
      }
      return [{ label: t("app.header.breadcrumbs.workflows") }];
    }
    if (context === "workflow") {
      return [
        { label: t("app.header.breadcrumbs.workflows"), href: "/home/workflows" },
        { label: t("app.header.breadcrumbs.editor") },
      ];
    }
    if (context === "settings") {
      return [{ label: t("app.header.breadcrumbs.settings") }];
    }
    return [];
  }, [context, pathname, t]);
}

type TabId = "editor" | "executions" | "tests";

function useWorkflowTabId(): TabId {
  const { pathname } = useLocation();
  if (pathname.endsWith("/executions")) return "executions";
  if (pathname.endsWith("/tests")) return "tests";
  return "editor";
}

function WorkflowTabs({ workflowId }: { workflowId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const activeTab = useWorkflowTabId();

  const tabs: { id: TabId; label: string }[] = [
    { id: "editor", label: t("app.header.tabs.editor") },
    { id: "executions", label: t("app.header.tabs.executions") },
    { id: "tests", label: t("app.header.tabs.tests") },
  ];

  function handleTabClick(id: TabId) {
    if (id === "editor") {
      navigate(`/workflow/${workflowId}`);
    } else {
      navigate(`/workflow/${workflowId}/${id}`);
    }
  }

  return (
    <div className="gc-app-header__tabs" role="tablist" aria-label={t("app.header.tabs.ariaLabel")}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          className={[
            "gc-app-header__tab",
            activeTab === tab.id ? "gc-app-header__tab--active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => handleTabClick(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function typeIconName(type: Notification["type"]): IconName {
  switch (type) {
    case "run_finished":
      return "circle-check";
    case "run_failed":
      return "circle-x";
    case "webhook_fired":
      return "webhook";
    case "user_joined":
      return "user-check";
    case "plugin_updated":
      return "package-open";
    case "system":
      return "cog";
    case "info":
    default:
      return "info";
  }
}

interface NotificationsBellProps {
  /** Optional override count (used by tests / external counters). */
  count?: number;
}

function NotificationsBell({ count: countProp }: NotificationsBellProps) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const notifications = useNotificationsStore((s) => s.notifications);
  const storeUnread = useNotificationsStore((s) => s.unreadCount);
  const markAllRead = useNotificationsStore((s) => s.markAllRead);

  // When a `count` prop is provided we honour it for the badge so that
  // existing call-sites passing `notificationsCount` keep working; otherwise
  // fall back to the live store unread count.
  const unread = countProp ?? storeUnread;

  const trigger = (
    <button
      type="button"
      className="gc-app-header__icon-btn"
      aria-label={t("app.header.notifications")}
      aria-haspopup="dialog"
      aria-expanded={open}
    >
      <Icon name="bell" size={18} />
      {unread > 0 && (
        <Badge
          count={unread}
          variant="danger"
          size="small"
          className="gc-app-header__bell-badge"
        />
      )}
    </button>
  );

  return (
    <Popover
      trigger={trigger}
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="end"
      width={360}
    >
      <div
        className="gc-notifications-popover"
        data-testid="notifications-popover"
        role="region"
        aria-label={t("notifications.heading")}
      >
        <div className="gc-notifications-popover__header">
          <span className="gc-notifications-popover__title">
            {t("notifications.heading")}
          </span>
          {unread > 0 && (
            <button
              type="button"
              className="gc-notifications-popover__mark-all"
              onClick={() => markAllRead()}
            >
              {t("notifications.markAllRead")}
            </button>
          )}
        </div>

        {notifications.length === 0 ? (
          <div className="gc-notifications-popover__empty">
            <EmptyState
              icon="bell"
              title={t("notifications.empty.title")}
              size="small"
            />
          </div>
        ) : (
          <ul className="gc-notifications-popover__list" role="list">
            {notifications.map((n) => (
              <NotificationItem key={n.id} notification={n} />
            ))}
          </ul>
        )}
      </div>
    </Popover>
  );
}

function NotificationItem({ notification }: { notification: Notification }) {
  const { t } = useTranslation();
  const markRead = useNotificationsStore((s) => s.markRead);
  const timestampMs = useMemo(() => {
    const ms = Date.parse(notification.timestamp);
    return Number.isFinite(ms) ? ms : Date.now();
  }, [notification.timestamp]);

  const itemClass = [
    "gc-notifications-popover__item",
    !notification.read ? "gc-notifications-popover__item--unread" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li
      className={itemClass}
      role="button"
      tabIndex={0}
      onClick={() => markRead(notification.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          markRead(notification.id);
        }
      }}
    >
      <span className="gc-notifications-popover__item-icon" aria-hidden="true">
        <Icon name={typeIconName(notification.type)} size={14} />
      </span>
      <div className="gc-notifications-popover__item-body">
        <div className="gc-notifications-popover__item-title">{notification.title}</div>
        {notification.message && (
          <div className="gc-notifications-popover__item-message">
            {notification.message}
          </div>
        )}
        <div className="gc-notifications-popover__item-time">
          {formatRelative(timestampMs, { justNow: t("notifications.justNow") })}
        </div>
      </div>
    </li>
  );
}

function UserAvatar() {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="gc-app-header__avatar"
      data-tour="user-menu"
      aria-label={t("app.header.userMenu", "User menu")}
    >
      <Icon name="circle-user-round" size={28} />
    </button>
  );
}

export function AppHeaderContent({
  workflowId: workflowIdProp,
  workflowName = "",
  onWorkflowNameChange,
  isDirty = false,
  isRunning = false,
  onSave,
  onRun,
  onStop,
  notificationsCount,
  workflowVersion = null,
}: AppHeaderProps) {
  const { t } = useTranslation();
  const context = useRouteContext();
  const breadcrumbs = useBreadcrumbs(context);
  const { graphId: routeGraphId } = useParams<{ graphId?: string }>();
  const effectiveWorkflowId = workflowIdProp ?? routeGraphId ?? "";
  const openModal = useUIStore((s) => s.openModal);

  const slotLeft = useHeaderSlotStore((s) => s.left);
  const slotCenter = useHeaderSlotStore((s) => s.center);
  const slotRight = useHeaderSlotStore((s) => s.right);

  const isWorkflow = context === "workflow";

  const versionLabel = workflowVersion != null
    ? `v${workflowVersion}`
    : t("app.workflows.versioning.draft");

  function handlePublish() {
    openModal(PUBLISH_WORKFLOW_MODAL_KEY, { graphId: effectiveWorkflowId });
  }

  function handleVersionHistory() {
    openModal(VERSIONS_MODAL_KEY, { graphId: effectiveWorkflowId });
  }

  return (
    <div className="gc-app-header">
      <div className="gc-app-header__left">
        <Breadcrumbs items={breadcrumbs} />

        {isWorkflow && (
          <>
            <span className="gc-app-header__name-sep" aria-hidden="true" />
            <div className="gc-app-header__workflow-name">
              <InlineTextEdit
                value={workflowName}
                onChange={(v) => onWorkflowNameChange?.(v)}
                placeholder={t("app.header.workflowNamePlaceholder")}
                size="small"
                commitOn="blur"
              />
            </div>
            <span
              className="gc-app-header__version-badge"
              title={t("app.workflows.versioning.versionBadgeTitle")}
              data-testid="version-badge"
            >
              {versionLabel}
            </span>
          </>
        )}

        {isWorkflow && effectiveWorkflowId && (
          <WorkflowTabs workflowId={effectiveWorkflowId} />
        )}

        {slotLeft && (
          <div
            className="gc-app-header__slot gc-app-header__slot--left"
            data-testid="header-slot-left"
          >
            {slotLeft}
          </div>
        )}
      </div>

      {slotCenter && (
        <div
          className="gc-app-header__slot gc-app-header__slot--center"
          data-testid="header-slot-center"
        >
          {slotCenter}
        </div>
      )}

      <div className="gc-app-header__spacer" />

      <div className="gc-app-header__right">
        {slotRight && (
          <div
            className="gc-app-header__slot gc-app-header__slot--right"
            data-testid="header-slot-right"
          >
            {slotRight}
          </div>
        )}
        <AiAssistantTrigger />
        <NotificationsBell count={notificationsCount} />

        {isWorkflow && (
          <>
            <Button
              variant="outline"
              size="small"
              iconLeft="save"
              onClick={onSave}
              aria-label={t("app.header.save")}
              className={isDirty ? "gc-app-header__save--dirty" : undefined}
            >
              {t("app.header.save")}
              {isDirty && (
                <span className="gc-app-header__dirty-dot" aria-label={t("app.header.unsavedChanges")} />
              )}
            </Button>

            <Button
              variant="outline"
              size="small"
              iconLeft="upload"
              onClick={handlePublish}
              aria-label={t("app.workflows.versioning.publishButton")}
              data-testid="publish-btn"
            >
              {t("app.workflows.versioning.publishButton")}
            </Button>

            <DropdownMenu
              trigger={
                <button
                  type="button"
                  className="gc-app-header__icon-btn"
                  aria-label={t("app.workflows.versioning.moreActions")}
                  data-testid="versions-menu-btn"
                >
                  <Icon name="more-horizontal" size={18} />
                </button>
              }
              items={[
                {
                  id: "version-history",
                  label: t("app.workflows.versioning.versionHistory"),
                  icon: "git-branch",
                  onSelect: handleVersionHistory,
                },
              ]}
              align="end"
            />

            {isRunning ? (
              <Button
                variant="destructive"
                size="small"
                iconLeft="circle-x"
                onClick={onStop}
                aria-label={t("app.header.stop")}
              >
                {t("app.header.stop")}
              </Button>
            ) : (
              <Button
                variant="success"
                size="small"
                iconLeft="play"
                onClick={onRun}
                aria-label={t("app.header.run")}
                data-tour="run-button"
              >
                {t("app.header.run")}
              </Button>
            )}
          </>
        )}

        <UserAvatar />
      </div>
      <AiAssistantPanel />
    </div>
  );
}

export function AppHeader(props: AppHeaderProps) {
  const slot = document.getElementById("gc-header-slot");
  if (!slot) return null;
  return createPortal(<AppHeaderContent {...props} />, slot);
}
