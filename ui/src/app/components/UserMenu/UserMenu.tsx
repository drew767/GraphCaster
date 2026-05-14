// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { useNavigate } from "react-router-dom";

import { Avatar } from "../../../components/ui/Avatar/Avatar";
import { DropdownMenu, type DropdownItem } from "../../../components/ui/DropdownMenu/DropdownMenu";
import { Icon } from "../../../components/ui/Icon/Icon";

import "./UserMenu.css";

const DEFAULT_USER = { name: "Local User", email: "local@graphcaster" };

export interface UserMenuProps {
  user?: { name: string; email: string; avatarUrl?: string };
  collapsed?: boolean;
  onLogout?: () => void;
  onThemeChange?: (theme: "light" | "dark" | "auto") => void;
}

function UserPill({
  user,
  collapsed,
}: {
  user: { name: string; email: string; avatarUrl?: string };
  collapsed?: boolean;
}) {
  const pillClass = [
    "gc-user-pill",
    collapsed ? "gc-user-pill--collapsed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={pillClass} type="button" data-testid="user-pill">
      <Avatar
        src={user.avatarUrl}
        fallback={user.name}
        size="xsmall"
        shape="circle"
      />
      {!collapsed && (
        <span className="gc-user-pill__info">
          <span className="gc-user-pill__name">{user.name}</span>
          <span className="gc-user-pill__email">{user.email}</span>
        </span>
      )}
      {!collapsed && (
        <span className="gc-user-pill__chevron">
          <Icon name="chevrons-up-down" size={12} />
        </span>
      )}
    </button>
  );
}

export function UserMenu({
  user,
  collapsed = false,
  onLogout,
  onThemeChange,
}: UserMenuProps) {
  const resolvedUser = user ?? DEFAULT_USER;
  const navigate = useNavigate();

  const themeItems: DropdownItem[] = [
    {
      id: "theme-light",
      label: "Light",
      icon: "sun",
      onSelect: () => onThemeChange?.("light"),
    },
    {
      id: "theme-dark",
      label: "Dark",
      icon: "contrast",
      onSelect: () => onThemeChange?.("dark"),
    },
    {
      id: "theme-auto",
      label: "Auto",
      icon: "circle",
      onSelect: () => onThemeChange?.("auto"),
    },
  ];

  const items: DropdownItem[] = [
    // User identity header (non-interactive via groupLabel)
    {
      id: "user-header",
      groupLabel: `${resolvedUser.name} · ${resolvedUser.email}`,
    },
    {
      id: "header-separator",
      separator: true,
    },
    {
      id: "personal-settings",
      label: "Personal settings",
      icon: "user-pen",
      onSelect: () => navigate("/settings/personal"),
    },
    {
      id: "api-keys",
      label: "API Keys",
      icon: "key-round",
      onSelect: () => navigate("/settings/api-keys"),
    },
    {
      id: "theme-separator",
      separator: true,
    },
    {
      id: "theme",
      label: "Theme",
      icon: "palette",
      children: themeItems,
    },
    {
      id: "logout-separator",
      separator: true,
    },
    {
      id: "logout",
      label: "Log out",
      icon: "log-out",
      destructive: true,
      onSelect: () => onLogout?.(),
    },
  ];

  const trigger = (
    <span>
      <UserPill user={resolvedUser} collapsed={collapsed} />
    </span>
  );

  return (
    <DropdownMenu
      trigger={trigger}
      items={items}
      side="top"
      align="start"
    />
  );
}
