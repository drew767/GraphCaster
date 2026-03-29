// Copyright GraphCaster. All Rights Reserved.

import { KEYBOARD_SHORTCUTS_CATALOG } from "../lib/keyboardShortcutsCatalog";

/**
 * Returns the canonical shortcut list shown in the F1 / View → Keyboard shortcuts modal.
 * AppShell registers the actual `window` listeners; keep behavior and this catalog aligned.
 */
export function useKeyboardShortcutsCatalog() {
  return KEYBOARD_SHORTCUTS_CATALOG;
}
