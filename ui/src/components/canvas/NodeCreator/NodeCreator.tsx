// Copyright GraphCaster. All Rights Reserved.
// UX74 — Node Creator: big modal replacing / additive to sidebar palette.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { filterCatalog, NODE_CATALOG, type NodeCatalogEntry } from "../../../palette/useNodeCatalog";
import { Dialog } from "../../ui/Dialog/Dialog";
import { Icon } from "../../ui/Icon/Icon";
import { Button } from "../../ui/Button/Button";
import { useRecentlyUsedNodes } from "./useRecentlyUsedNodes";
import "./NodeCreator.css";

/* ─────────────────────────────────────────────────────────
   Types
   ───────────────────────────────────────────────────────── */

export interface NodeCreatorProps {
  open: boolean;
  onClose: () => void;
  onInsert: (nodeType: string, position?: { x: number; y: number }) => void;
  insertPosition?: { x: number; y: number };
  defaultFilter?: "all" | "triggers" | "actions";
  sourceNodeId?: string;
}

type FilterChip = "all" | "triggers" | "actions";

const CATEGORIES = [
  { id: "all", labelKey: "app.nodeCreator.catAll" },
  { id: "flow", labelKey: "app.nodeCreator.catFlow" },
  { id: "steps", labelKey: "app.nodeCreator.catSteps" },
  { id: "notes", labelKey: "app.nodeCreator.catNotes" },
  { id: "nested", labelKey: "app.nodeCreator.catNested" },
] as const;

type CategoryId = (typeof CATEGORIES)[number]["id"];

const KIND_ICON: Record<string, string> = {
  start: "zap",
  exit: "door-open",
  trigger_webhook: "webhook",
  trigger_schedule: "calendar",
  task: "bot",
  llm_agent: "brain",
  agent: "sparkles",
  http_request: "globe",
  rag_query: "database",
  rag_index: "layers",
  delay: "clock",
  debounce: "hourglass",
  wait_for: "circle-pause",
  set_variable: "variable",
  python_code: "code",
  graph_ref: "git-branch",
  merge: "arrow-left-right",
  fork: "split",
  mcp_tool: "mcp",
  ai_route: "sparkles",
  composio_action: "zap",
  comment: "sticky-note",
  group: "box",
};

function nodeIcon(kind: string): string {
  return KIND_ICON[kind] ?? "circle-ellipsis";
}

/* ─────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────── */

function applyChipFilter(entries: NodeCatalogEntry[], chip: FilterChip): NodeCatalogEntry[] {
  if (chip === "triggers") {
    return entries.filter((e) => e.type.startsWith("trigger_") || e.type === "start");
  }
  if (chip === "actions") {
    return entries.filter((e) => !e.type.startsWith("trigger_") && e.type !== "start");
  }
  return entries;
}

function applyCategoryFilter(entries: NodeCatalogEntry[], cat: CategoryId): NodeCatalogEntry[] {
  if (cat === "all") return entries;
  return entries.filter((e) => e.category === cat);
}

/* ─────────────────────────────────────────────────────────
   Component
   ───────────────────────────────────────────────────────── */

export function NodeCreator({
  open,
  onClose,
  onInsert,
  insertPosition,
  defaultFilter = "all",
  sourceNodeId: _sourceNodeId,
}: NodeCreatorProps) {
  const { t } = useTranslation();
  const searchRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<FilterChip>(defaultFilter);
  const [category, setCategory] = useState<CategoryId>("all");
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [hoveredType, setHoveredType] = useState<string | null>(null);

  const { recentNodeTypes, recordUsage } = useRecentlyUsedNodes();

  // Reset state when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setChip(defaultFilter);
      setCategory("all");
      setFocusedIndex(0);
      setHoveredType(null);
      requestAnimationFrame(() => {
        searchRef.current?.focus();
      });
    }
  }, [open, defaultFilter]);

  const allFiltered = useMemo(() => {
    const bySearch = filterCatalog(NODE_CATALOG, query);
    const byChip = applyChipFilter(bySearch, chip);
    return applyCategoryFilter(byChip, category);
  }, [query, chip, category]);

  const recentEntries = useMemo(() => {
    if (query.trim() !== "") return [];
    return recentNodeTypes
      .map((t) => NODE_CATALOG.find((e) => e.type === t))
      .filter((e): e is NodeCatalogEntry => e !== undefined);
  }, [recentNodeTypes, query]);

  const listWithoutRecent = useMemo(() => {
    const recentSet = new Set(recentEntries.map((e) => e.type));
    return allFiltered.filter((e) => !recentSet.has(e.type));
  }, [allFiltered, recentEntries]);

  // Flattened list for keyboard nav (recent first, then rest)
  const flatList = useMemo(() => {
    return [...recentEntries, ...listWithoutRecent];
  }, [recentEntries, listWithoutRecent]);

  const previewEntry = useMemo(() => {
    if (hoveredType) {
      return NODE_CATALOG.find((e) => e.type === hoveredType) ?? null;
    }
    return flatList[focusedIndex] ?? null;
  }, [hoveredType, focusedIndex, flatList]);

  const handleInsert = useCallback(
    (nodeType: string) => {
      recordUsage(nodeType);
      onInsert(nodeType, insertPosition);
      onClose();
    },
    [recordUsage, onInsert, insertPosition, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((i) => Math.min(i + 1, flatList.length - 1));
        setHoveredType(null);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((i) => Math.max(i - 1, 0));
        setHoveredType(null);
        return;
      }
      if (e.key === "Enter") {
        const entry = flatList[focusedIndex];
        if (entry) {
          handleInsert(entry.type);
        }
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const currentIdx = CATEGORIES.findIndex((c) => c.id === category);
        const next = (currentIdx + 1) % CATEGORIES.length;
        setCategory(CATEGORIES[next].id);
        setFocusedIndex(0);
        return;
      }
    },
    [flatList, focusedIndex, handleInsert, onClose, category],
  );

  const handleQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setFocusedIndex(0);
    setHoveredType(null);
  }, []);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => { if (!v) onClose(); }}
      size="2xlarge"
      showCloseButton={false}
      closeOnOverlayClick
      closeOnEsc
      ariaLabel={t("app.nodeCreator.modalLabel")}
    >
      <div
        className="gc-node-creator"
        onKeyDown={handleKeyDown}
        data-testid="node-creator"
      >
        {/* Header */}
        <div className="gc-node-creator__header">
          <div className="gc-node-creator__search-wrap">
            <span className="gc-node-creator__search-icon">
              <Icon name="search" size={16} />
            </span>
            <input
              ref={searchRef}
              type="text"
              className="gc-node-creator__search"
              placeholder={t("app.nodeCreator.searchPlaceholder")}
              value={query}
              onChange={handleQueryChange}
              aria-label={t("app.nodeCreator.searchPlaceholder")}
              aria-controls="gc-node-creator-grid"
              data-testid="node-creator-search"
              autoComplete="off"
            />
          </div>

          <div className="gc-node-creator__chips" role="group" aria-label={t("app.nodeCreator.filterChipsLabel")}>
            {(["all", "triggers", "actions"] as FilterChip[]).map((c) => (
              <button
                key={c}
                type="button"
                className={`gc-node-creator__chip${chip === c ? " gc-node-creator__chip--active" : ""}`}
                onClick={() => { setChip(c); setFocusedIndex(0); }}
                aria-pressed={chip === c}
              >
                {t(`app.nodeCreator.chip.${c}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="gc-node-creator__body">
          {/* Left rail — categories */}
          <nav className="gc-node-creator__categories" aria-label={t("app.nodeCreator.categoriesLabel")}>
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                className={`gc-node-creator__cat-btn${category === cat.id ? " gc-node-creator__cat-btn--active" : ""}`}
                onClick={() => { setCategory(cat.id); setFocusedIndex(0); setHoveredType(null); }}
                aria-current={category === cat.id ? "true" : undefined}
              >
                {t(cat.labelKey)}
              </button>
            ))}
          </nav>

          {/* Center grid */}
          <div
            className="gc-node-creator__grid-wrap"
            id="gc-node-creator-grid"
            role="listbox"
            aria-label={t("app.nodeCreator.gridLabel")}
          >
            {/* Recently used */}
            {recentEntries.length > 0 && (
              <>
                <p className="gc-node-creator__section-heading">{t("app.nodeCreator.recentHeading")}</p>
                <div className="gc-node-creator__grid">
                  {recentEntries.map((entry, idx) => (
                    <NodeCard
                      key={`recent-${entry.type}`}
                      entry={entry}
                      focused={!hoveredType && focusedIndex === idx}
                      onInsert={handleInsert}
                      onHover={setHoveredType}
                    />
                  ))}
                </div>
              </>
            )}

            {/* Main list */}
            {listWithoutRecent.length > 0 ? (
              <>
                {recentEntries.length > 0 && (
                  <p className="gc-node-creator__section-heading">{t("app.nodeCreator.allNodesHeading")}</p>
                )}
                <div className="gc-node-creator__grid">
                  {listWithoutRecent.map((entry, idx) => {
                    const absIdx = recentEntries.length + idx;
                    return (
                      <NodeCard
                        key={entry.type}
                        entry={entry}
                        focused={!hoveredType && focusedIndex === absIdx}
                        onInsert={handleInsert}
                        onHover={setHoveredType}
                      />
                    );
                  })}
                </div>
              </>
            ) : allFiltered.length === 0 ? (
              <div className="gc-node-creator__empty" data-testid="node-creator-empty">
                {t("app.nodeCreator.emptyState")}
              </div>
            ) : null}
          </div>

          {/* Right rail — preview */}
          <div className="gc-node-creator__preview" aria-label={t("app.nodeCreator.previewLabel")}>
            {previewEntry ? (
              <>
                <div className="gc-node-creator__preview-icon">
                  <Icon
                    name={nodeIcon(previewEntry.type) as Parameters<typeof Icon>[0]["name"]}
                    size={24}
                  />
                </div>
                <p className="gc-node-creator__preview-name">{previewEntry.displayName}</p>
                <p className="gc-node-creator__preview-category">{previewEntry.category}</p>
                <p className="gc-node-creator__preview-desc">{previewEntry.description}</p>
                <div className="gc-node-creator__preview-insert">
                  <Button
                    variant="solid"
                    size="small"
                    fullWidth
                    onClick={() => handleInsert(previewEntry.type)}
                  >
                    {t("app.nodeCreator.insertBtn")}
                  </Button>
                </div>
              </>
            ) : (
              <span className="gc-node-creator__preview-empty">{t("app.nodeCreator.previewHint")}</span>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/* ─────────────────────────────────────────────────────────
   NodeCard
   ───────────────────────────────────────────────────────── */

interface NodeCardProps {
  entry: NodeCatalogEntry;
  focused: boolean;
  onInsert: (nodeType: string) => void;
  onHover: (nodeType: string | null) => void;
}

function NodeCard({ entry, focused, onInsert, onHover }: NodeCardProps) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (focused && ref.current && typeof ref.current.scrollIntoView === "function") {
      ref.current.scrollIntoView({ block: "nearest" });
    }
  }, [focused]);

  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={focused}
      className={`gc-node-creator__card${focused ? " gc-node-creator__card--selected" : ""}`}
      onClick={() => onInsert(entry.type)}
      onMouseEnter={() => onHover(entry.type)}
      onMouseLeave={() => onHover(null)}
      data-testid={`node-card-${entry.type}`}
    >
      <span className="gc-node-creator__card-icon">
        <Icon
          name={nodeIcon(entry.type) as Parameters<typeof Icon>[0]["name"]}
          size={22}
        />
      </span>
      <span className="gc-node-creator__card-name">{entry.displayName}</span>
    </button>
  );
}
