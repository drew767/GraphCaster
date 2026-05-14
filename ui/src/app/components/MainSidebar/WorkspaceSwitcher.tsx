// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { useTranslation } from "react-i18next";

import { DropdownMenu, type DropdownItem } from "../../../components/ui/DropdownMenu/DropdownMenu";
import { Icon } from "../../../components/ui/Icon/Icon";

export interface Workspace {
  id: string;
  name: string;
}

export const WORKSPACE_STORAGE_KEY = "gc.workspace";
export const WORKSPACES_STORAGE_KEY = "gc.workspaces";

const DEFAULT_WORKSPACE: Workspace = { id: "personal", name: "Personal" };

function readPersistedWorkspace(): Workspace {
  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return DEFAULT_WORKSPACE;
    const parsed = JSON.parse(raw) as Workspace;
    if (parsed && typeof parsed.id === "string" && typeof parsed.name === "string") {
      return parsed;
    }
  } catch {
    // ignore
  }
  return DEFAULT_WORKSPACE;
}

function readPersistedWorkspaces(): Workspace[] {
  try {
    const raw = localStorage.getItem(WORKSPACES_STORAGE_KEY);
    if (!raw) return [DEFAULT_WORKSPACE];
    const parsed = JSON.parse(raw) as Workspace[];
    if (Array.isArray(parsed) && parsed.every((w) => w && typeof w.id === "string" && typeof w.name === "string")) {
      return parsed.length > 0 ? parsed : [DEFAULT_WORKSPACE];
    }
  } catch {
    // ignore
  }
  return [DEFAULT_WORKSPACE];
}

function persistWorkspace(workspace: Workspace): void {
  try {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspace));
  } catch {
    // ignore
  }
}

export interface WorkspaceSwitcherProps {
  current?: Workspace;
  workspaces?: Workspace[];
  onChange?: (workspace: Workspace) => void;
}

export function WorkspaceSwitcher({ current, workspaces, onChange }: WorkspaceSwitcherProps) {
  const { t } = useTranslation();
  const [active, setActive] = React.useState<Workspace>(() => current ?? readPersistedWorkspace());
  const list = workspaces ?? readPersistedWorkspaces();

  React.useEffect(() => {
    if (current) setActive(current);
  }, [current]);

  const handleSelect = (workspace: Workspace) => {
    setActive(workspace);
    persistWorkspace(workspace);
    onChange?.(workspace);
  };

  const items: DropdownItem[] = list.map((workspace) => ({
    id: `workspace-${workspace.id}`,
    label: workspace.name,
    icon: "building-2",
    onSelect: () => handleSelect(workspace),
  }));

  const trigger = (
    <button
      type="button"
      className="gc-workspace-switcher"
      data-testid="workspace-switcher"
      aria-label={t("app.sidebar.workspace.switchAriaLabel")}
    >
      <Icon name="building-2" size={16} aria-hidden />
      <span className="gc-workspace-switcher__name">{active.name}</span>
      <Icon name="chevrons-up-down" size={12} aria-hidden />
    </button>
  );

  return <DropdownMenu trigger={trigger} items={items} side="bottom" align="start" />;
}
