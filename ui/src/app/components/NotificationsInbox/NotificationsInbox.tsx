// Copyright GraphCaster. All Rights Reserved.

import React, { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { Popover } from "../../../components/ui/Popover/Popover";
import { Badge } from "../../../components/ui/Badge/Badge";
import { Button } from "../../../components/ui/Button/Button";
import { Icon } from "../../../components/ui/Icon/Icon";
import { useNotificationsStore, type Notification } from "../../stores/notificationsStore";
import { EmptyState } from "../../../components/ui/EmptyState/EmptyState";

import "./NotificationsInbox.css";

function relativeTime(iso: string, justNow: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return justNow;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

type IconVariant = "success" | "danger" | "accent" | "neutral";

function typeIconInfo(type: Notification["type"]): {
  name: Parameters<typeof Icon>[0]["name"];
  variant: IconVariant;
} {
  switch (type) {
    case "run_finished":
      return { name: "circle-check", variant: "success" };
    case "run_failed":
      return { name: "circle-x", variant: "danger" };
    case "webhook_fired":
      return { name: "webhook", variant: "accent" };
    case "user_joined":
      return { name: "user-check", variant: "accent" };
    case "plugin_updated":
      return { name: "package-open", variant: "neutral" };
    case "system":
      return { name: "cog", variant: "neutral" };
    case "info":
    default:
      return { name: "info", variant: "accent" };
  }
}

// ---------------------------------------------------------------------------

interface NotifItemProps {
  notification: Notification;
  onClose: () => void;
}

function NotifItem({ notification, onClose }: NotifItemProps) {
  const { markRead, remove } = useNotificationsStore();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { name: iconName, variant } = typeIconInfo(notification.type);

  const handleClick = useCallback(() => {
    markRead(notification.id);
    if (notification.link) {
      navigate(notification.link);
      onClose();
    }
  }, [markRead, navigate, notification.id, notification.link, onClose]);

  const handleDismiss = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      remove(notification.id);
    },
    [remove, notification.id]
  );

  const itemClass = [
    "gc-notif-item",
    !notification.read ? "gc-notif-item--unread" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li className={itemClass} onClick={handleClick} role="button" tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && handleClick()}>
      <span className={`gc-notif-item__icon gc-notif-item__icon--${variant}`}>
        <Icon name={iconName} size={14} />
      </span>
      <div className="gc-notif-item__body">
        <div className="gc-notif-item__title">{notification.title}</div>
        {notification.message && (
          <div className="gc-notif-item__message">{notification.message}</div>
        )}
        <div className="gc-notif-item__meta">
          <span className="gc-notif-item__time">{relativeTime(notification.timestamp, t("app.notifications.justNow"))}</span>
        </div>
      </div>
      <button
        className="gc-notif-item__dismiss"
        aria-label={t("app.notifications.dismissAria")}
        onClick={handleDismiss}
        tabIndex={-1}
      >
        <Icon name="x" size={12} />
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------

export function NotificationsInbox() {
  const { t } = useTranslation();
  const { notifications, unreadCount, markAllRead, clearAll } =
    useNotificationsStore();

  const [open, setOpen] = React.useState(false);
  const prevCountRef = useRef(unreadCount);
  const [animating, setAnimating] = React.useState(false);

  useEffect(() => {
    if (unreadCount > prevCountRef.current) {
      setAnimating(true);
      const tid = setTimeout(() => setAnimating(false), 600);
      return () => clearTimeout(tid);
    }
    prevCountRef.current = unreadCount;
  }, [unreadCount]);

  const handleClose = useCallback(() => setOpen(false), []);

  const bellClass = ["gc-notif-bell", animating ? "gc-notif-bell--animate" : ""]
    .filter(Boolean)
    .join(" ");

  const trigger = (
    <span className="gc-notif-trigger" aria-label={t("app.notifications.heading")}>
      <Button variant="ghost" size="small" aria-label={t("app.notifications.openAria")} onClick={() => setOpen((o) => !o)}>
        <span className={bellClass}>
          <Icon name="bell" size={18} />
        </span>
      </Button>
      {unreadCount > 0 && (
        <span className="gc-notif-badge">
          <Badge count={unreadCount} variant="danger" size="small" />
        </span>
      )}
    </span>
  );

  return (
    <Popover
      trigger={trigger}
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="end"
      width={320}
    >
      <div className="gc-notif-popover">
        <div className="gc-notif-header">
          <span className="gc-notif-header__title">{t("app.notifications.heading")}</span>
          <div className="gc-notif-header__actions">
            {unreadCount > 0 && (
              <button className="gc-notif-mark-all" onClick={markAllRead}>
                {t("app.notifications.markAllRead")}
              </button>
            )}
            <button className="gc-notif-close" aria-label={t("app.notifications.closeAria")} onClick={handleClose}>
              <Icon name="x" size={14} />
            </button>
          </div>
        </div>

        {notifications.length === 0 ? (
          <div className="gc-notif-empty">
            <EmptyState
              icon="bell"
              title={t("app.empty.notifications.title")}
              description={t("app.empty.notifications.description")}
              size="small"
            />
          </div>
        ) : (
          <ul className="gc-notif-list" role="list">
            {notifications.map((n) => (
              <NotifItem key={n.id} notification={n} onClose={handleClose} />
            ))}
          </ul>
        )}

        {notifications.length > 0 && (
          <div className="gc-notif-footer">
            <Button variant="ghost" size="xsmall" fullWidth onClick={clearAll}>
              {t("app.notifications.clearAll")}
            </Button>
          </div>
        )}
      </div>
    </Popover>
  );
}
