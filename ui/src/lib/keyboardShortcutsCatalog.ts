// Copyright GraphCaster. All Rights Reserved.

/**
 * Canonical list of app keyboard shortcuts for the shortcuts modal and docs.
 * Display strings use i18n keys under `app.shortcuts.*`.
 */
export type ShortcutCatalogEntry = {
  /** i18n key for the action label */
  actionKey: string;
  /** i18n key for the key chord description (e.g. "Ctrl+Z") */
  keysKey: string;
};

export const KEYBOARD_SHORTCUTS_CATALOG: readonly ShortcutCatalogEntry[] = [
  { actionKey: "app.shortcuts.undo", keysKey: "app.shortcuts.keys.undo" },
  { actionKey: "app.shortcuts.redo", keysKey: "app.shortcuts.keys.redo" },
  { actionKey: "app.shortcuts.findNode", keysKey: "app.shortcuts.keys.findNode" },
  { actionKey: "app.shortcuts.togglePalette", keysKey: "app.shortcuts.keys.togglePalette" },
  { actionKey: "app.shortcuts.openAddNodeMenu", keysKey: "app.shortcuts.keys.openAddNodeMenu" },
  { actionKey: "app.shortcuts.copyNodes", keysKey: "app.shortcuts.keys.copy" },
  { actionKey: "app.shortcuts.pasteNodes", keysKey: "app.shortcuts.keys.paste" },
  { actionKey: "app.shortcuts.group", keysKey: "app.shortcuts.keys.group" },
  { actionKey: "app.shortcuts.ungroup", keysKey: "app.shortcuts.keys.ungroup" },
  { actionKey: "app.shortcuts.openShortcuts", keysKey: "app.shortcuts.keys.openShortcuts" },
] as const;
