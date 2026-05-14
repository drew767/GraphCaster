// Copyright GraphCaster. All Rights Reserved.

import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Dialog } from "../../../components/ui/Dialog/Dialog";
import { Input } from "../../../components/ui/Input/Input";
import { KeyboardShortcut } from "../../../components/ui/KeyboardShortcut/KeyboardShortcut";
import {
  KEYBOARD_SHORTCUTS_CATALOG,
  type ShortcutCatalogEntry,
} from "../../../lib/keyboardShortcutsCatalog";
import { useReturnFocus } from "../../../lib/hooks/useReturnFocus";

import "./KeyboardShortcutsModal.css";

export interface KeyboardShortcutsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type CategoryId = ShortcutCatalogEntry["category"];

const CATEGORY_ORDER: readonly CategoryId[] = [
  "edit",
  "view",
  "navigation",
  "selection",
  "run",
];

function categoryLabelKey(id: CategoryId): string {
  return `shortcuts.modal.category.${id}`;
}

function splitChord(value: string): string[] {
  // Accept "or" alternatives as a single rendered token to keep layout calm.
  // Splitting on "+" is handled by the KeyboardShortcut primitive itself.
  return [value];
}

interface GroupedEntries {
  category: CategoryId;
  entries: ShortcutCatalogEntry[];
}

function groupByCategory(
  entries: readonly ShortcutCatalogEntry[],
): GroupedEntries[] {
  const groups = new Map<CategoryId, ShortcutCatalogEntry[]>();
  for (const e of entries) {
    const bucket = groups.get(e.category) ?? [];
    bucket.push(e);
    groups.set(e.category, bucket);
  }
  const out: GroupedEntries[] = [];
  for (const cat of CATEGORY_ORDER) {
    const list = groups.get(cat);
    if (list && list.length > 0) {
      out.push({ category: cat, entries: list });
    }
  }
  // Append any unknown categories (defensive — keeps catalog forward-compatible).
  for (const [cat, list] of groups) {
    if (!CATEGORY_ORDER.includes(cat)) {
      out.push({ category: cat, entries: list });
    }
  }
  return out;
}

export function KeyboardShortcutsModal({
  open,
  onOpenChange,
}: KeyboardShortcutsModalProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  useReturnFocus(open);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return KEYBOARD_SHORTCUTS_CATALOG;
    return KEYBOARD_SHORTCUTS_CATALOG.filter((entry) => {
      const label = t(entry.actionKey).toLowerCase();
      return label.includes(q);
    });
  }, [query, t]);

  const grouped = useMemo(() => groupByCategory(filtered), [filtered]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="large"
      title={t("shortcuts.modal.title")}
    >
      <div className="gc-shortcuts-modal" data-testid="shortcuts-modal">
        <div className="gc-shortcuts-modal__search">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("shortcuts.modal.searchPlaceholder")}
            aria-label={t("shortcuts.modal.searchPlaceholder")}
            data-testid="shortcuts-modal-search"
            autoFocus
          />
        </div>

        {grouped.length === 0 ? (
          <div className="gc-shortcuts-modal__empty">
            {t("shortcuts.modal.noResults")}
          </div>
        ) : (
          <div className="gc-shortcuts-modal__groups">
            {grouped.map(({ category, entries }) => (
              <section
                key={category}
                className="gc-shortcuts-modal__group"
                data-testid={`shortcuts-group-${category}`}
              >
                <h3 className="gc-shortcuts-modal__group-title">
                  {t(categoryLabelKey(category))}
                </h3>
                <ul className="gc-shortcuts-modal__list">
                  {entries.map((entry) => {
                    const keys = t(entry.keysKey);
                    return (
                      <li
                        key={entry.id}
                        className="gc-shortcuts-modal__row"
                        data-testid={`shortcuts-row-${entry.id}`}
                      >
                        <span className="gc-shortcuts-modal__label">
                          {t(entry.actionKey)}
                        </span>
                        <span className="gc-shortcuts-modal__keys">
                          {splitChord(keys).map((chord, i) => (
                            <React.Fragment key={i}>
                              {i > 0 && (
                                <span className="gc-shortcuts-modal__or">
                                  {t("shortcuts.modal.or")}
                                </span>
                              )}
                              <KeyboardShortcut keys={chord} size="small" />
                            </React.Fragment>
                          ))}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
