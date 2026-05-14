// Copyright GraphCaster. All Rights Reserved.

/**
 * Canonical list of app keyboard shortcuts surfaced in the F1 / View →
 * Keyboard shortcuts modal and reused by the command bar to render chord
 * hints. Each entry MUST correspond to a real, wired binding — do not add
 * entries for shortcuts that do not yet have a handler, otherwise users will
 * see actions in the help modal that silently do nothing.
 *
 * Display strings use i18n keys under `app.shortcuts.*`; category headings
 * use `shortcuts.modal.category.*`.
 */
export type ShortcutCategory =
  | "edit"
  | "view"
  | "navigation"
  | "selection"
  | "run";

export type ShortcutCatalogEntry = {
  /** Stable identifier referenced by command-bar items and tests. */
  id: string;
  /** i18n key for the action label */
  actionKey: string;
  /** i18n key for the key chord description (e.g. "Ctrl+Z") */
  keysKey: string;
  /** Grouping bucket used by the shortcuts modal. */
  category: ShortcutCategory;
};

export const KEYBOARD_SHORTCUTS_CATALOG: readonly ShortcutCatalogEntry[] = [
  { id: "undo", actionKey: "app.shortcuts.undo", keysKey: "app.shortcuts.keys.undo", category: "edit" },
  { id: "redo", actionKey: "app.shortcuts.redo", keysKey: "app.shortcuts.keys.redo", category: "edit" },
  { id: "copyNodes", actionKey: "app.shortcuts.copyNodes", keysKey: "app.shortcuts.keys.copy", category: "edit" },
  { id: "pasteNodes", actionKey: "app.shortcuts.pasteNodes", keysKey: "app.shortcuts.keys.paste", category: "edit" },
  { id: "group", actionKey: "app.shortcuts.group", keysKey: "app.shortcuts.keys.group", category: "edit" },
  { id: "ungroup", actionKey: "app.shortcuts.ungroup", keysKey: "app.shortcuts.keys.ungroup", category: "edit" },
  { id: "openAddNodeMenu", actionKey: "app.shortcuts.openAddNodeMenu", keysKey: "app.shortcuts.keys.openAddNodeMenu", category: "edit" },
  { id: "findNode", actionKey: "app.shortcuts.findNode", keysKey: "app.shortcuts.keys.findNode", category: "navigation" },
  { id: "togglePalette", actionKey: "app.shortcuts.togglePalette", keysKey: "app.shortcuts.keys.togglePalette", category: "navigation" },
  { id: "commandBar", actionKey: "app.shortcuts.commandBar", keysKey: "app.shortcuts.keys.commandBar", category: "navigation" },
  { id: "showKeyboardShortcuts", actionKey: "app.shortcuts.showKeyboardShortcuts", keysKey: "app.shortcuts.keys.showKeyboardShortcuts", category: "navigation" },
  { id: "openShortcuts", actionKey: "app.shortcuts.openShortcuts", keysKey: "app.shortcuts.keys.openShortcuts", category: "navigation" },
] as const;
