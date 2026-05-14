// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { createPortal } from "react-dom";
import { NavLink, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { Icon, type IconName } from "../../../components/ui/Icon/Icon";
import { Avatar } from "../../../components/ui/Avatar/Avatar";
import { DropdownMenu, type DropdownItem } from "../../../components/ui/DropdownMenu/DropdownMenu";
import { useThemeStore, type Theme } from "../../../stores/themeStore";

import {
  SidebarResizer,
  clampSidebarWidth,
  persistSidebarWidth,
  readPersistedSidebarWidth,
} from "./SidebarResizer";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import "./MainSidebar.css";

// ---------------------------------------------------------------------------
// Types and data
// ---------------------------------------------------------------------------

interface SidebarNavItem {
  labelKey: string;
  to: string;
  icon: IconName;
  end?: boolean;
}

const NAV_ITEMS: SidebarNavItem[] = [
  { labelKey: "app.sidebar.workflows", to: "/home/workflows", icon: "git-branch", end: true },
  { labelKey: "app.sidebar.executions", to: "/home/executions", icon: "circle-play", end: true },
  { labelKey: "app.sidebar.credentials", to: "/home/credentials", icon: "key-round", end: true },
  { labelKey: "app.sidebar.templates", to: "/templates", icon: "layout-template", end: true },
  { labelKey: "app.sidebar.projects", to: "/projects", icon: "folder", end: true },
  { labelKey: "app.sidebar.plugins", to: "/settings/community-nodes", icon: "plug", end: true },
];

interface SettingsSubItem {
  labelKey: string;
  to: string;
}

const SETTINGS_SUB_ITEMS: SettingsSubItem[] = [
  { labelKey: "app.settings.nav.personal", to: "/settings/personal" },
  { labelKey: "app.settings.nav.apiKeys", to: "/settings/api-keys" },
  { labelKey: "app.settings.nav.users", to: "/settings/users" },
  { labelKey: "app.settings.nav.variables", to: "/settings/variables" },
  { labelKey: "app.settings.nav.externalSecrets", to: "/settings/external-secrets" },
  { labelKey: "app.settings.nav.communityNodes", to: "/settings/community-nodes" },
  { labelKey: "app.settings.nav.sourceControl", to: "/settings/source-control" },
  { labelKey: "app.settings.nav.sso", to: "/settings/sso" },
  { labelKey: "app.settings.nav.audit", to: "/settings/audit" },
  { labelKey: "app.settings.nav.logStreaming", to: "/settings/log-streaming" },
  { labelKey: "app.settings.nav.workers", to: "/settings/workers" },
  { labelKey: "app.settings.nav.about", to: "/settings/about" },
];

// ---------------------------------------------------------------------------
// Starred workflows
// ---------------------------------------------------------------------------

const STARRED_STORAGE_KEY = "gc.starred_workflows";
const STARRED_MAX_VISIBLE = 8;

interface StarredEntry {
  id: string;
  name: string;
}

function readStarredEntries(): StarredEntry[] {
  try {
    const raw = localStorage.getItem(STARRED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const out: StarredEntry[] = [];
      for (const item of parsed) {
        if (typeof item === "string") {
          out.push({ id: item, name: item });
        } else if (item && typeof item === "object") {
          const obj = item as { id?: unknown; name?: unknown };
          if (typeof obj.id === "string") {
            out.push({ id: obj.id, name: typeof obj.name === "string" ? obj.name : obj.id });
          }
        }
      }
      return out;
    }
  } catch {
    // ignore
  }
  return [];
}

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

const USER_STORAGE_KEY = "gc.user";
const DEFAULT_USER = { name: "You", email: "you@example.com" };

interface UserInfo {
  name: string;
  email: string;
  avatarUrl?: string;
}

function readUser(): UserInfo {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    if (!raw) return DEFAULT_USER;
    const parsed = JSON.parse(raw) as Partial<UserInfo>;
    if (parsed && typeof parsed.name === "string" && typeof parsed.email === "string") {
      return {
        name: parsed.name,
        email: parsed.email,
        avatarUrl: typeof parsed.avatarUrl === "string" ? parsed.avatarUrl : undefined,
      };
    }
  } catch {
    // ignore
  }
  return DEFAULT_USER;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StarredSection({ entries }: { entries: StarredEntry[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(true);
  const visible = entries.slice(0, STARRED_MAX_VISIBLE);
  const overflow = Math.max(0, entries.length - visible.length);

  return (
    <div className="gc-main-sidebar__section" data-testid="sidebar-starred-section">
      <button
        type="button"
        className="gc-main-sidebar__section-header"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid="sidebar-starred-toggle"
      >
        <Icon name="star" size={14} aria-hidden />
        <span className="gc-main-sidebar__section-title">{t("app.sidebar.starred.title")}</span>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={12} aria-hidden />
      </button>
      {open && (
        <ul className="gc-main-sidebar__sublist" role="list" data-testid="sidebar-starred-list">
          {visible.length === 0 ? (
            <li className="gc-main-sidebar__empty" data-testid="sidebar-starred-empty">
              {t("app.sidebar.starred.empty")}
            </li>
          ) : (
            visible.map((entry) => (
              <li key={entry.id}>
                <NavLink
                  to={`/workflow/${entry.id}`}
                  className="gc-main-sidebar__subitem"
                  data-testid={`sidebar-starred-item-${entry.id}`}
                >
                  <Icon name="git-branch" size={14} aria-hidden />
                  <span className="gc-main-sidebar__label">{entry.name}</span>
                </NavLink>
              </li>
            ))
          )}
          {overflow > 0 && (
            <li>
              <NavLink
                to="/workflows?filter=starred"
                className="gc-main-sidebar__subitem gc-main-sidebar__subitem--muted"
                data-testid="sidebar-starred-showall"
              >
                {t("app.sidebar.starred.showAll", { count: entries.length })}
              </NavLink>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function SettingsSection() {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);

  return (
    <div className="gc-main-sidebar__section" data-testid="sidebar-settings-section">
      <div className="gc-main-sidebar__section-row">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            ["gc-main-sidebar__item", isActive ? "gc-main-sidebar__item--active" : ""]
              .filter(Boolean)
              .join(" ")
          }
          data-testid="sidebar-nav-settings"
        >
          <Icon name="settings" size={18} aria-hidden />
          <span className="gc-main-sidebar__label">{t("app.sidebar.settings")}</span>
        </NavLink>
        <button
          type="button"
          className="gc-main-sidebar__chevron-button"
          aria-expanded={open}
          aria-label={t("app.sidebar.settingsToggleAriaLabel")}
          onClick={() => setOpen((v) => !v)}
          data-testid="sidebar-settings-toggle"
        >
          <Icon name={open ? "chevron-down" : "chevron-right"} size={12} aria-hidden />
        </button>
      </div>
      {open && (
        <ul className="gc-main-sidebar__sublist" role="list" data-testid="sidebar-settings-sublist">
          {SETTINGS_SUB_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  [
                    "gc-main-sidebar__subitem",
                    isActive ? "gc-main-sidebar__subitem--active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")
                }
                data-testid={`sidebar-settings-sub-${item.to.replace("/settings/", "")}`}
              >
                <span className="gc-main-sidebar__label">{t(item.labelKey)}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UserBar({ user }: { user: UserInfo }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setTheme = useThemeStore((s) => s.setTheme);

  const handleSignOut = () => {
    try {
      void fetch("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);
    } catch {
      // ignore
    }
    navigate("/signin", { replace: true });
  };

  const themeItems: DropdownItem[] = [
    {
      id: "theme-light",
      label: t("app.sidebar.user.theme.light"),
      icon: "sun",
      onSelect: () => setTheme("light" as Theme),
    },
    {
      id: "theme-auto",
      label: t("app.sidebar.user.theme.system"),
      icon: "monitor",
      onSelect: () => setTheme("auto" as Theme),
    },
    {
      id: "theme-dark",
      label: t("app.sidebar.user.theme.dark"),
      icon: "moon",
      onSelect: () => setTheme("dark" as Theme),
    },
  ];

  const items: DropdownItem[] = [
    {
      id: "user-header",
      groupLabel: `${user.name} · ${user.email}`,
    },
    { id: "user-header-sep", separator: true },
    {
      id: "account",
      label: t("app.sidebar.user.account"),
      icon: "user-pen",
      onSelect: () => navigate("/settings/personal"),
    },
    {
      id: "theme",
      label: t("app.sidebar.user.theme.label"),
      icon: "palette",
      children: themeItems,
    },
    { id: "signout-sep", separator: true },
    {
      id: "signout",
      label: t("app.sidebar.user.signOut"),
      icon: "log-out",
      destructive: true,
      onSelect: handleSignOut,
    },
  ];

  const trigger = (
    <button
      type="button"
      className="gc-main-sidebar__user"
      data-testid="sidebar-user-trigger"
      aria-label={t("app.sidebar.user.ariaLabel")}
    >
      <Avatar src={user.avatarUrl} fallback={user.name} size="medium" shape="circle" />
      <span className="gc-main-sidebar__user-name">{user.name}</span>
      <Icon name="chevrons-up-down" size={12} aria-hidden />
    </button>
  );

  return <DropdownMenu trigger={trigger} items={items} side="top" align="start" />;
}

// ---------------------------------------------------------------------------
// SidebarContent
// ---------------------------------------------------------------------------

function SidebarContent({
  containerRef,
  width,
  onWidthChange,
}: {
  containerRef: React.RefObject<HTMLDivElement>;
  width: number;
  onWidthChange: (next: number) => void;
}) {
  const { t } = useTranslation();
  const [starred, setStarred] = React.useState<StarredEntry[]>(() => readStarredEntries());
  const [user, setUser] = React.useState<UserInfo>(() => readUser());

  React.useEffect(() => {
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === STARRED_STORAGE_KEY) setStarred(readStarredEntries());
      if (ev.key === USER_STORAGE_KEY) setUser(readUser());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <div
      ref={containerRef}
      className="gc-main-sidebar"
      data-testid="main-sidebar"
      aria-label={t("app.sidebar.ariaLabel")}
      role="navigation"
    >
      <div className="gc-main-sidebar__workspace">
        <WorkspaceSwitcher />
      </div>

      <nav className="gc-main-sidebar__nav" aria-label={t("app.sidebar.ariaLabel")}>
        <ul className="gc-main-sidebar__list" role="list">
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  [
                    "gc-main-sidebar__item",
                    isActive ? "gc-main-sidebar__item--active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")
                }
                data-testid={`sidebar-nav-${item.labelKey.split(".").pop() ?? ""}`}
                data-tour={
                  item.labelKey === "app.sidebar.workflows"
                    ? "sidebar-workflows"
                    : item.labelKey === "app.sidebar.executions"
                      ? "sidebar-executions"
                      : undefined
                }
                aria-label={t(item.labelKey)}
              >
                <Icon name={item.icon} size={18} aria-hidden />
                <span className="gc-main-sidebar__label">{t(item.labelKey)}</span>
              </NavLink>
            </li>
          ))}
        </ul>

        <StarredSection entries={starred} />
        <SettingsSection />
      </nav>

      <div className="gc-main-sidebar__footer">
        <UserBar user={user} />
      </div>

      <SidebarResizer width={width} onWidthChange={onWidthChange} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// MainSidebar wrapper — portals into the layout aside slot
// ---------------------------------------------------------------------------

export interface MainSidebarProps {
  portalTarget?: HTMLElement | null;
}

export function MainSidebar({ portalTarget }: MainSidebarProps) {
  const target =
    portalTarget !== undefined
      ? portalTarget
      : typeof document !== "undefined"
        ? document.getElementById("gc-sidebar-slot")
        : null;

  const [width, setWidth] = React.useState<number>(() => readPersistedSidebarWidth());
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!target) return;
    target.style.setProperty("--gc-sidebar-width", `${clampSidebarWidth(width)}px`);
  }, [target, width]);

  React.useEffect(() => {
    persistSidebarWidth(width);
  }, [width]);

  if (!target) return null;

  return createPortal(
    <SidebarContent containerRef={containerRef} width={width} onWidthChange={setWidth} />,
    target,
  );
}
