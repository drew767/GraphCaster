// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Command } from "cmdk";

import { Icon } from "../../../components/ui/Icon/Icon";
import { KeyboardShortcut } from "../../../components/ui/KeyboardShortcut/KeyboardShortcut";
import type { IconName } from "../../../components/ui/Icon/registry";
import { isTextEditingTarget } from "../../../lib/isTextEditingTarget";
import { KEYBOARD_SHORTCUTS_CATALOG } from "../../../lib/keyboardShortcutsCatalog";
import { useCommandBarStore, MAX_RECENT_SHOWN } from "../../stores/commandBarStore";
import type { FavoriteEntry } from "../../stores/commandBarStore";
import { getAllNodeTypes } from "../../../graph/nodeCatalog";
import "./AppCommandBar.css";

/**
 * Map a command-bar item identifier to a shortcut catalog entry id.
 * Allows the command bar to reuse the canonical shortcuts catalog instead of
 * hard-coding chord strings on every item.
 */
const COMMAND_TO_SHORTCUT_ID: Record<string, string> = {
  "help-shortcuts": "showKeyboardShortcuts",
  "create-workflow": "newWorkflow",
  "action-run": "executeWorkflow",
};

function resolveShortcut(
  commandId: string,
  t: (key: string) => string,
): string | undefined {
  const shortcutId = COMMAND_TO_SHORTCUT_ID[commandId];
  if (!shortcutId) return undefined;
  const entry = KEYBOARD_SHORTCUTS_CATALOG.find((e) => e.id === shortcutId);
  if (!entry) return undefined;
  const resolved = t(entry.keysKey);
  // i18next returns the key when missing — skip in that case.
  return resolved && resolved !== entry.keysKey ? resolved : undefined;
}

export interface CommandBarItem {
  id: string;
  label: string;
  group: string;
  icon?: IconName;
  shortcut?: string;
  href?: string;
  action?: () => void;
  keywords?: string[];
}

export interface AppCommandBarProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  items?: CommandBarItem[];
}

function useStaticItems(
  onShortcuts: () => void,
  onWorkflowPath: boolean,
): CommandBarItem[] {
  const { t } = useTranslation();

  const createItems: CommandBarItem[] = [
    {
      id: "create-workflow",
      label: t("app.commandBar.items.newWorkflow"),
      group: t("app.commandBar.groups.create"),
      icon: "plus",
      href: "/workflow/new",
    },
  ];

  const navigateItems: CommandBarItem[] = [
    {
      id: "nav-workflows",
      label: t("app.commandBar.items.goToWorkflows"),
      group: t("app.commandBar.groups.navigate"),
      icon: "workflow",
      href: "/home/workflows",
    },
    {
      id: "nav-executions",
      label: t("app.commandBar.items.goToExecutions"),
      group: t("app.commandBar.groups.navigate"),
      icon: "history",
      href: "/home/executions",
    },
    {
      id: "nav-templates",
      label: t("app.commandBar.items.goToTemplates"),
      group: t("app.commandBar.groups.navigate"),
      icon: "layout-template",
      href: "/templates",
    },
    {
      id: "nav-settings",
      label: t("app.commandBar.items.goToSettings"),
      group: t("app.commandBar.groups.navigate"),
      icon: "settings",
      href: "/settings",
    },
    {
      id: "nav-credentials",
      label: t("app.commandBar.items.goToCredentials"),
      group: t("app.commandBar.groups.navigate"),
      icon: "key-round",
      href: "/home/credentials",
    },
  ];

  const actionItems: CommandBarItem[] = onWorkflowPath
    ? [
        {
          id: "action-run",
          label: t("app.commandBar.items.runWorkflow"),
          group: t("app.commandBar.groups.actions"),
          icon: "play",
          action: () => {},
        },
        {
          id: "action-save",
          label: t("app.commandBar.items.saveWorkflow"),
          group: t("app.commandBar.groups.actions"),
          icon: "save",
          action: () => {},
        },
        {
          id: "action-export",
          label: t("app.commandBar.items.exportWorkflow"),
          group: t("app.commandBar.groups.actions"),
          icon: "download",
          action: () => {},
        },
        {
          id: "action-layout",
          label: t("app.commandBar.items.autoLayout"),
          group: t("app.commandBar.groups.actions"),
          icon: "waypoints",
          action: () => {},
        },
        ...EDITOR_ACTIONS.map<CommandBarItem>((e) => ({
          id: `editor-${e.id}`,
          label: t(e.labelKey, e.fallback),
          group: t("commandBar.groups.editor", "Editor"),
          icon: e.icon,
          keywords: e.keywords,
          action: () => {
            const evt = new CustomEvent("gc:editorAction", {
              detail: { action: e.id },
            });
            window.dispatchEvent(evt);
          },
        })),
      ]
    : [];

  const viewItems: CommandBarItem[] = VIEW_COMMANDS.map((v) => ({
    id: `view-${v.id}`,
    label: t(v.labelKey, v.fallback),
    group: t("commandBar.groups.view", "View"),
    icon: v.icon,
    keywords: v.keywords,
    action: () => {
      const evt = new CustomEvent("gc:viewAction", { detail: { action: v.id } });
      window.dispatchEvent(evt);
    },
  }));

  const systemItems: CommandBarItem[] = SYSTEM_COMMANDS.map((s) => ({
    id: `system-${s.id}`,
    label: t(s.labelKey, s.fallback),
    group: t("commandBar.groups.system", "System"),
    icon: s.icon,
    keywords: s.keywords,
    action: () => {
      const evt = new CustomEvent("gc:systemAction", {
        detail: { action: s.id },
      });
      window.dispatchEvent(evt);
    },
  }));

  const helpItems: CommandBarItem[] = [
    {
      id: "help-shortcuts",
      label: t("app.commandBar.items.shortcuts"),
      group: t("app.commandBar.groups.help"),
      icon: "info",
      shortcut: "F1",
      action: onShortcuts,
    },
    {
      id: "help-docs",
      label: t("app.commandBar.items.openDocs"),
      group: t("app.commandBar.groups.help"),
      icon: "book-open",
      action: () => {},
    },
  ];

  const routeItems: CommandBarItem[] = ROUTE_INDEX.map((r) => ({
    id: `route-${r.id}`,
    label: t(r.labelKey, r.fallback),
    group: t("app.commandBar.groups.navigate"),
    icon: r.icon,
    href: r.href,
    keywords: r.keywords,
  }));

  const nodeItems: CommandBarItem[] = onWorkflowPath
    ? getAllNodeTypes().map((node) => {
        const baseLabel = t(node.displayNameKey, node.type);
        return {
          id: `node-${node.type}`,
          label: t("commandBar.addNodeLabel", "Add node: {{name}}", {
            name: baseLabel,
          }),
          group: t("commandBar.groups.addNode", "Add node"),
          icon: "plus" as IconName,
          keywords: [node.type, node.category, baseLabel],
          action: () => {
            const evt = new CustomEvent("gc:addNode", {
              detail: { type: node.type },
            });
            window.dispatchEvent(evt);
          },
        };
      })
    : [];

  const settingsItems: CommandBarItem[] = SETTINGS_INDEX.map((s) => ({
    id: `settings-${s.id}`,
    label: t(s.labelKey, s.fallback),
    group: t("app.commandBar.groups.settings"),
    icon: s.icon,
    href: s.href,
    keywords: s.keywords,
  }));

  return [
    ...createItems,
    ...navigateItems,
    ...actionItems,
    ...routeItems,
    ...settingsItems,
    ...nodeItems,
    ...viewItems,
    ...systemItems,
    ...helpItems,
  ];
}

interface SimpleCommand {
  id: string;
  labelKey: string;
  fallback: string;
  icon: IconName;
  keywords?: string[];
}

const EDITOR_ACTIONS: readonly SimpleCommand[] = [
  { id: "undo", labelKey: "commandBar.editor.undo", fallback: "Undo", icon: "undo-2", keywords: ["history"] },
  { id: "redo", labelKey: "commandBar.editor.redo", fallback: "Redo", icon: "redo-2", keywords: ["history"] },
  { id: "copy", labelKey: "commandBar.editor.copy", fallback: "Copy selection", icon: "copy" },
  { id: "paste", labelKey: "commandBar.editor.paste", fallback: "Paste", icon: "clipboard" },
  { id: "duplicate", labelKey: "commandBar.editor.duplicate", fallback: "Duplicate selection", icon: "copy" },
  { id: "delete", labelKey: "commandBar.editor.delete", fallback: "Delete selection", icon: "trash-2" },
  { id: "select-all", labelKey: "commandBar.editor.selectAll", fallback: "Select all", icon: "square-check" },
  { id: "group", labelKey: "commandBar.editor.group", fallback: "Group selection", icon: "square-plus" },
  { id: "ungroup", labelKey: "commandBar.editor.ungroup", fallback: "Ungroup selection", icon: "square-minus" },
  { id: "comment", labelKey: "commandBar.editor.comment", fallback: "Add comment", icon: "message-square" },
  { id: "sticky", labelKey: "commandBar.editor.sticky", fallback: "Add sticky note", icon: "sticky-note" },
  { id: "rename", labelKey: "commandBar.editor.rename", fallback: "Rename node", icon: "pencil" },
  { id: "find-node", labelKey: "commandBar.editor.findNode", fallback: "Find node", icon: "search" },
  { id: "open-add-node", labelKey: "commandBar.editor.openAddNode", fallback: "Open add-node menu", icon: "plus" },
  { id: "pin-data", labelKey: "commandBar.editor.pinData", fallback: "Pin node data", icon: "pin" },
  { id: "unpin-data", labelKey: "commandBar.editor.unpinData", fallback: "Unpin node data", icon: "pin" },
  { id: "disable-node", labelKey: "commandBar.editor.disableNode", fallback: "Disable node", icon: "ban" },
  { id: "enable-node", labelKey: "commandBar.editor.enableNode", fallback: "Enable node", icon: "check" },
  { id: "execute-node", labelKey: "commandBar.editor.executeNode", fallback: "Execute selected node", icon: "play" },
];

const VIEW_COMMANDS: readonly SimpleCommand[] = [
  { id: "zoom-in", labelKey: "commandBar.view.zoomIn", fallback: "Zoom in", icon: "zoom-in" },
  { id: "zoom-out", labelKey: "commandBar.view.zoomOut", fallback: "Zoom out", icon: "zoom-out" },
  { id: "fit-view", labelKey: "commandBar.view.fitView", fallback: "Fit view to graph", icon: "maximize" },
  { id: "center-selection", labelKey: "commandBar.view.centerSelection", fallback: "Center selection", icon: "crosshair" },
  { id: "toggle-minimap", labelKey: "commandBar.view.toggleMinimap", fallback: "Toggle minimap", icon: "grid-2x2" },
  { id: "toggle-grid", labelKey: "commandBar.view.toggleGrid", fallback: "Toggle grid", icon: "grid-2x2" },
  { id: "toggle-sidebar", labelKey: "commandBar.view.toggleSidebar", fallback: "Toggle sidebar", icon: "panel-left" },
  { id: "toggle-rightpanel", labelKey: "commandBar.view.toggleRightPanel", fallback: "Toggle right panel", icon: "panel-right" },
  { id: "toggle-palette", labelKey: "commandBar.view.togglePalette", fallback: "Toggle node palette", icon: "layers" },
  { id: "toggle-fullscreen", labelKey: "commandBar.view.toggleFullscreen", fallback: "Toggle fullscreen", icon: "maximize-2" },
  { id: "focus-node", labelKey: "commandBar.view.focusNode", fallback: "Focus selected node", icon: "crosshair" },
];

const SYSTEM_COMMANDS: readonly SimpleCommand[] = [
  { id: "theme-light", labelKey: "commandBar.system.themeLight", fallback: "Theme: Light", icon: "sun" },
  { id: "theme-dark", labelKey: "commandBar.system.themeDark", fallback: "Theme: Dark", icon: "moon" },
  { id: "theme-auto", labelKey: "commandBar.system.themeAuto", fallback: "Theme: System", icon: "contrast" },
  { id: "lang-en", labelKey: "commandBar.system.langEn", fallback: "Language: English", icon: "languages" },
  { id: "lang-ru", labelKey: "commandBar.system.langRu", fallback: "Language: Russian", icon: "languages" },
  { id: "reload-app", labelKey: "commandBar.system.reload", fallback: "Reload app", icon: "refresh-cw" },
  { id: "report-bug", labelKey: "commandBar.system.reportBug", fallback: "Report a bug", icon: "bug" },
  { id: "open-changelog", labelKey: "commandBar.system.changelog", fallback: "Open changelog", icon: "scroll-text" },
  { id: "open-docs", labelKey: "commandBar.system.docs", fallback: "Open documentation", icon: "book-open" },
  { id: "open-community", labelKey: "commandBar.system.community", fallback: "Open community", icon: "users" },
  { id: "open-status", labelKey: "commandBar.system.status", fallback: "Open status page", icon: "circle-dot" },
  { id: "copy-link", labelKey: "commandBar.system.copyLink", fallback: "Copy page link", icon: "link" },
  { id: "logout", labelKey: "commandBar.system.logout", fallback: "Log out", icon: "log-out" },
];

interface RouteIndexEntry {
  id: string;
  href: string;
  labelKey: string;
  fallback: string;
  icon: IconName;
  keywords?: string[];
}

const ROUTE_INDEX: readonly RouteIndexEntry[] = [
  { id: "home", href: "/home/workflows", labelKey: "commandBar.routes.home", fallback: "Home", icon: "house", keywords: ["dashboard", "start"] },
  { id: "workflows", href: "/home/workflows", labelKey: "commandBar.routes.workflows", fallback: "Workflows", icon: "workflow", keywords: ["flows", "graphs"] },
  { id: "workflows-archive", href: "/home/workflows?tab=archive", labelKey: "commandBar.routes.workflowsArchive", fallback: "Workflows · Archive", icon: "archive" },
  { id: "executions", href: "/home/executions", labelKey: "commandBar.routes.executions", fallback: "Executions", icon: "history", keywords: ["runs", "logs"] },
  { id: "templates", href: "/templates", labelKey: "commandBar.routes.templates", fallback: "Templates", icon: "layout-template", keywords: ["gallery"] },
  { id: "credentials", href: "/home/credentials", labelKey: "commandBar.routes.credentials", fallback: "Credentials", icon: "key-round", keywords: ["secrets", "auth"] },
  { id: "projects", href: "/projects", labelKey: "commandBar.routes.projects", fallback: "Projects", icon: "folder", keywords: ["teams"] },
  { id: "new-workflow", href: "/workflow/new", labelKey: "commandBar.routes.newWorkflow", fallback: "New workflow", icon: "plus", keywords: ["create"] },
  { id: "signin", href: "/signin", labelKey: "commandBar.routes.signin", fallback: "Sign in", icon: "log-in" },
  { id: "signup", href: "/signup", labelKey: "commandBar.routes.signup", fallback: "Sign up", icon: "user" },
  { id: "signout", href: "/signout", labelKey: "commandBar.routes.signout", fallback: "Sign out", icon: "log-out" },
  { id: "forgot-password", href: "/forgot-password", labelKey: "commandBar.routes.forgotPassword", fallback: "Forgot password", icon: "key-round" },
  { id: "change-password", href: "/change-password", labelKey: "commandBar.routes.changePassword", fallback: "Change password", icon: "key-round" },
  { id: "setup", href: "/setup", labelKey: "commandBar.routes.setup", fallback: "Setup", icon: "settings" },
  { id: "entity-not-found", href: "/entity-not-found", labelKey: "commandBar.routes.entityNotFound", fallback: "Entity not found", icon: "triangle-alert" },
  { id: "unauthorized", href: "/unauthorized", labelKey: "commandBar.routes.unauthorized", fallback: "Unauthorized", icon: "shield" },
];

const SETTINGS_INDEX: readonly RouteIndexEntry[] = [
  { id: "personal", href: "/settings/personal", labelKey: "commandBar.settings.personal", fallback: "Settings · Personal", icon: "user", keywords: ["profile", "account"] },
  { id: "api-keys", href: "/settings/api-keys", labelKey: "commandBar.settings.apiKeys", fallback: "Settings · API keys", icon: "key-round", keywords: ["tokens"] },
  { id: "users", href: "/settings/users", labelKey: "commandBar.settings.users", fallback: "Settings · Users", icon: "users", keywords: ["members", "team"] },
  { id: "external-secrets", href: "/settings/external-secrets", labelKey: "commandBar.settings.externalSecrets", fallback: "Settings · External secrets", icon: "lock", keywords: ["vault"] },
  { id: "community-nodes", href: "/settings/community-nodes", labelKey: "commandBar.settings.communityNodes", fallback: "Settings · Community nodes", icon: "package-open", keywords: ["plugins"] },
  { id: "source-control", href: "/settings/source-control", labelKey: "commandBar.settings.sourceControl", fallback: "Settings · Source control", icon: "git-branch", keywords: ["git"] },
  { id: "sso", href: "/settings/sso", labelKey: "commandBar.settings.sso", fallback: "Settings · SSO", icon: "shield", keywords: ["saml", "oidc"] },
  { id: "audit", href: "/settings/audit", labelKey: "commandBar.settings.audit", fallback: "Settings · Audit log", icon: "list", keywords: ["events"] },
  { id: "variables", href: "/settings/variables", labelKey: "commandBar.settings.variables", fallback: "Settings · Variables", icon: "code", keywords: ["env"] },
  { id: "environments", href: "/settings/environments", labelKey: "commandBar.settings.environments", fallback: "Settings · Environments", icon: "globe", keywords: ["stages"] },
  { id: "log-streaming", href: "/settings/log-streaming", labelKey: "commandBar.settings.logStreaming", fallback: "Settings · Log streaming", icon: "rss", keywords: ["logs"] },
  { id: "workers", href: "/settings/workers", labelKey: "commandBar.settings.workers", fallback: "Settings · Workers", icon: "cog", keywords: ["queue"] },
  { id: "about", href: "/settings/about", labelKey: "commandBar.settings.about", fallback: "Settings · About", icon: "info" },
];

interface RecentEntry {
  id: string;
  name?: string;
  label?: string;
  workflowId?: string;
  visitedAt?: string;
}

function readRecent(key: string): RecentEntry[] {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 25) as RecentEntry[];
  } catch {
    return [];
  }
}

function useDynamicItems(): {
  recentWorkflows: CommandBarItem[];
  recentExecutions: CommandBarItem[];
} {
  const { t } = useTranslation();
  return useMemo(() => {
    const wfRaw = readRecent("gc.recent_workflows");
    const exRaw = readRecent("gc.recent_executions");
    const recentWorkflows: CommandBarItem[] = wfRaw
      .filter((e) => typeof e?.id === "string")
      .map((e) => ({
        id: `recent-wf-${e.id}`,
        label: e.name ?? e.label ?? e.id ?? "",
        group: t("commandBar.recent.workflows", "Recent workflows"),
        icon: "workflow" as IconName,
        href: `/workflow/${e.id}`,
      }));
    const recentExecutions: CommandBarItem[] = exRaw
      .filter((e) => typeof e?.id === "string")
      .map((e) => ({
        id: `recent-ex-${e.id}`,
        label: e.label ?? e.name ?? `Execution ${e.id}`,
        group: t("commandBar.recent.executions", "Recent executions"),
        icon: "history" as IconName,
        href: `/home/executions/${e.id}`,
      }));
    return { recentWorkflows, recentExecutions };
  }, [t]);
}

export function AppCommandBar({ open: openProp, onOpenChange, items: itemsProp }: AppCommandBarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const storeOpen = useCommandBarStore((s) => s.open);
  const setStoreOpen = useCommandBarStore((s) => s.setOpen);
  const recentRoutes = useCommandBarStore((s) => s.recentRoutes);
  const pushRoute = useCommandBarStore((s) => s.pushRoute);
  const favorites = useCommandBarStore((s) => s.favorites);
  const isFavorite = useCommandBarStore((s) => s.isFavorite);
  const toggleFavorite = useCommandBarStore((s) => s.toggleFavorite);

  const [, setShortcutsOpen] = useState(false);

  // Controlled vs. uncontrolled open state
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : storeOpen;
  const setOpen = useCallback(
    (value: boolean) => {
      if (isControlled) {
        onOpenChange?.(value);
      } else {
        setStoreOpen(value);
      }
    },
    [isControlled, onOpenChange, setStoreOpen],
  );

  const onWorkflowPath = pathname.startsWith("/workflow/");

  const onShortcutsAction = useCallback(() => {
    setOpen(false);
    setShortcutsOpen(true);
  }, [setOpen]);

  const staticItems = useStaticItems(onShortcutsAction, onWorkflowPath);
  const { recentWorkflows, recentExecutions } = useDynamicItems();
  const allItems =
    itemsProp ?? [...staticItems, ...recentWorkflows, ...recentExecutions];

  // Register global Cmd/Ctrl+K hotkey
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTextEditingTarget(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [setOpen]);

  const handleSelect = useCallback(
    (item: CommandBarItem) => {
      setOpen(false);
      if (item.href) {
        pushRoute({ href: item.href, label: item.label });
        navigate(item.href);
      } else if (item.action) {
        item.action();
      }
    },
    [setOpen, navigate, pushRoute],
  );

  const backdropRef = useRef<HTMLDivElement>(null);
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === backdropRef.current) {
        setOpen(false);
      }
    },
    [setOpen],
  );

  // Group items
  const groupNames = Array.from(new Set(allItems.map((i) => i.group)));

  const recentItems: CommandBarItem[] = recentRoutes.slice(0, MAX_RECENT_SHOWN).map((r) => ({
    id: `recent-${r.href}`,
    label: r.label,
    group: t("app.commandBar.groups.recent"),
    icon: "history" as IconName,
    href: r.href,
  }));

  const favoriteItems: CommandBarItem[] = favorites.map((f: FavoriteEntry) => ({
    id: `fav-${f.href}`,
    label: f.label,
    group: t("app.cmdBar.favorites"),
    icon: "pin" as IconName,
    href: f.href,
  }));

  const allGrouped: Array<{ group: string; items: CommandBarItem[] }> = [];

  if (favoriteItems.length > 0) {
    allGrouped.push({ group: t("app.cmdBar.favorites"), items: favoriteItems });
  }

  if (recentItems.length > 0) {
    allGrouped.push({ group: t("app.cmdBar.recent"), items: recentItems });
  }

  for (const group of groupNames) {
    const groupItems = allItems.filter((i) => i.group === group);
    if (groupItems.length > 0) {
      allGrouped.push({ group, items: groupItems });
    }
  }

  if (!open) return null;

  const portal = (
    <div
      ref={backdropRef}
      className="gc-cmd-backdrop"
      data-testid="gc-cmd-backdrop"
      onClick={handleBackdropClick}
    >
      <Command
        className="gc-cmd-panel"
        label={t("app.commandBar.placeholder")}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
          }
        }}
      >
        <div className="gc-cmd-input-wrap">
          <span className="gc-cmd-search-icon" aria-hidden="true">
            <Icon name="search" size={16} />
          </span>
          <Command.Input
            className="gc-cmd-input"
            placeholder={t("app.commandBar.placeholder")}
            autoFocus
          />
        </div>
        <Command.List className="gc-cmd-list">
          <Command.Empty>{t("app.commandBar.emptyState")}</Command.Empty>
          {allGrouped.map(({ group, items }) => (
            <Command.Group key={group} heading={group}>
              {items.map((item) => {
                const shortcutKeys = item.shortcut ?? resolveShortcut(item.id, t);
                return (
                <Command.Item
                  key={item.id}
                  value={[item.label, ...(item.keywords ?? [])].join(" ")}
                  onSelect={() => handleSelect(item)}
                >
                  {item.icon && (
                    <span className="gc-cmd-item-icon">
                      <Icon name={item.icon} size={14} />
                    </span>
                  )}
                  <span className="gc-cmd-item-label">{item.label}</span>
                  {shortcutKeys && (
                    <span
                      className="gc-cmd-item-shortcut"
                      data-testid={`cmd-shortcut-${item.id}`}
                    >
                      <KeyboardShortcut keys={shortcutKeys} size="xsmall" />
                    </span>
                  )}
                  {item.href && (
                    <button
                      type="button"
                      aria-label={
                        isFavorite(item.href)
                          ? t("app.cmdBar.unfavorite")
                          : t("app.cmdBar.favorite")
                      }
                      aria-pressed={isFavorite(item.href)}
                      className={
                        "gc-cmd-item-star" +
                        (isFavorite(item.href) ? " gc-cmd-item-star--active" : "")
                      }
                      data-testid={`cmd-star-${item.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (item.href) {
                          toggleFavorite({ href: item.href, label: item.label });
                        }
                      }}
                    >
                      <Icon name="pin" size={12} />
                    </button>
                  )}
                </Command.Item>
                );
              })}
            </Command.Group>
          ))}
        </Command.List>
      </Command>
    </div>
  );

  return createPortal(portal, document.body);
}
