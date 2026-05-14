// Copyright GraphCaster. All Rights Reserved.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";

import { Input } from "../../../ui/Input/Input";
import { Select } from "../../../ui/Select/Select";
import { Spinner } from "../../../ui/Spinner/Spinner";
import { Icon } from "../../../ui/Icon/Icon";
import "./ResourceLocator.css";

/* ── Types ──────────────────────────────────────────────────────── */

export type ResourceLocatorMode = "id" | "url" | "list";

export interface ResourceLocatorValue {
  mode: ResourceLocatorMode;
  value: string;
  cachedName?: string;
}

export interface ResourceLocatorOption {
  id: string;
  name: string;
  description?: string;
  url?: string;
}

export interface ResourceLocatorProps {
  value: ResourceLocatorValue;
  onChange: (newValue: ResourceLocatorValue) => void;
  loadOptions: (
    query: string,
    cursor?: string,
  ) => Promise<{ options: ResourceLocatorOption[]; nextCursor?: string }>;
  modes?: ResourceLocatorMode[];
  defaultMode?: ResourceLocatorMode;
  placeholders?: Partial<Record<ResourceLocatorMode, string>>;
  disabled?: boolean;
  className?: string;
  parseUrl?: (url: string) => string | null;
}

/* ── Constants ──────────────────────────────────────────────────── */

const RECENT_CACHE_KEY = "gc-resource-locator-recent";
const RECENT_MAX = 5;
const SLOW_THRESHOLD_MS = 5000;
const DEBOUNCE_MS = 200;

/* ── Recent-cache helpers ───────────────────────────────────────── */

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_CACHE_KEY);
    if (raw) return JSON.parse(raw) as string[];
  } catch {
    // ignore
  }
  return [];
}

function saveRecent(query: string): void {
  try {
    const prev = loadRecent().filter((q) => q !== query);
    const next = [query, ...prev].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_CACHE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

/* ── Dropdown for list mode ─────────────────────────────────────── */

interface DropdownProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  loadOptions: ResourceLocatorProps["loadOptions"];
  currentValue: ResourceLocatorValue;
  onSelect: (opt: ResourceLocatorOption) => void;
  disabled?: boolean;
}

function ResourceLocatorDropdown({
  anchorRef,
  open,
  onClose,
  loadOptions,
  currentValue,
  onSelect,
}: DropdownProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<ResourceLocatorOption[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoverIndex, setHoverIndex] = useState(0);

  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  /* Position the dropdown under the anchor */
  const [style, setStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setStyle({
      position: "fixed",
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      zIndex: "var(--index-popper, 2000)" as unknown as number,
    });
  }, [open, anchorRef]);

  /* Focus search on open */
  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 0);
      setQuery("");
      setOptions([]);
      setNextCursor(undefined);
      setHoverIndex(0);
    }
  }, [open]);

  /* Fetch */
  const doFetch = useCallback(
    async (q: string, cursor?: string, append = false) => {
      setLoading(true);
      setError(null);
      setSlow(false);
      slowTimerRef.current = setTimeout(() => setSlow(true), SLOW_THRESHOLD_MS);
      try {
        saveRecent(q);
        const result = await loadOptions(q, cursor);
        setOptions((prev) => (append ? [...prev, ...result.options] : result.options));
        setNextCursor(result.nextCursor);
        setHoverIndex(0);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      } finally {
        setLoading(false);
        setSlow(false);
        if (slowTimerRef.current) clearTimeout(slowTimerRef.current);
      }
    },
    [loadOptions],
  );

  /* Debounce search */
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void doFetch(query);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open, doFetch]);

  /* Click outside */
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose, anchorRef]);

  /* Keyboard */
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setHoverIndex((i) => Math.min(i + 1, options.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHoverIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const opt = options[hoverIndex];
        if (opt) onSelect(opt);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [open, options, hoverIndex, onSelect, onClose]);

  /* Virtualizer */
  const virtualizer = useVirtualizer({
    count: options.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 44,
    overscan: 5,
  });

  if (!open) return null;

  return (
    <div
      ref={dropdownRef}
      className="gc-rl-dropdown"
      style={style}
      role="listbox"
      aria-label={t("app.ndv.resourceLocator.dropdown.ariaLabel")}
    >
      {/* Search */}
      <div className="gc-rl-dropdown__search">
        <Icon name="search" size={14} />
        <input
          ref={searchRef}
          className="gc-rl-dropdown__search-input"
          type="text"
          placeholder={t("app.ndv.resourceLocator.dropdown.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t("app.ndv.resourceLocator.dropdown.searchAriaLabel")}
        />
      </div>

      {/* Slow warning */}
      {slow && !error && (
        <div className="gc-rl-dropdown__notice gc-rl-dropdown__notice--slow">
          {t("app.ndv.resourceLocator.dropdown.slowNotice")}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="gc-rl-dropdown__notice gc-rl-dropdown__notice--error">
          <span>{error}</span>
          <button
            type="button"
            className="gc-rl-dropdown__retry"
            onClick={() => void doFetch(query)}
          >
            {t("app.ndv.resourceLocator.dropdown.retry")}
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && !error && (
        <div className="gc-rl-dropdown__loading" aria-live="polite">
          <Spinner size={16} />
        </div>
      )}

      {/* List */}
      {!loading && !error && options.length === 0 && (
        <div className="gc-rl-dropdown__empty">
          {t("app.ndv.resourceLocator.dropdown.noMatches")}
        </div>
      )}

      {!error && options.length > 0 && (
        <div
          ref={listRef}
          className="gc-rl-dropdown__list"
          style={{ height: Math.min(options.length * 44, 280) }}
        >
          <div
            style={{
              height: virtualizer.getTotalSize(),
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((vItem) => {
              const opt = options[vItem.index];
              const isCurrent = opt.id === currentValue.value;
              const isHovered = vItem.index === hoverIndex;
              return (
                <div
                  key={opt.id}
                  data-index={vItem.index}
                  ref={virtualizer.measureElement}
                  className={[
                    "gc-rl-dropdown__item",
                    isCurrent ? "gc-rl-dropdown__item--selected" : "",
                    isHovered ? "gc-rl-dropdown__item--hover" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vItem.start}px)`,
                  }}
                  role="option"
                  aria-selected={isCurrent}
                  onMouseEnter={() => setHoverIndex(vItem.index)}
                  onClick={() => onSelect(opt)}
                >
                  <span className="gc-rl-dropdown__item-name">{opt.name}</span>
                  {opt.description && (
                    <span className="gc-rl-dropdown__item-desc">
                      {opt.description}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Load more */}
      {!loading && !error && nextCursor && (
        <button
          type="button"
          className="gc-rl-dropdown__load-more"
          onClick={() => void doFetch(query, nextCursor, true)}
        >
          {t("app.ndv.resourceLocator.dropdown.loadMore")}
        </button>
      )}
    </div>
  );
}

/* ── Main component ─────────────────────────────────────────────── */

const DEFAULT_MODES: ResourceLocatorMode[] = ["id", "url", "list"];

export function ResourceLocator({
  value,
  onChange,
  loadOptions,
  modes = DEFAULT_MODES,
  defaultMode,
  placeholders,
  disabled = false,
  className,
  parseUrl,
}: ResourceLocatorProps) {
  const { t } = useTranslation();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const effectiveMode = value.mode ?? defaultMode ?? modes[0] ?? "id";

  /* Mode select options */
  const modeOptions = useMemo(
    () =>
      modes.map((m) => ({
        value: m,
        label: t(`app.ndv.resourceLocator.mode.${m}`),
      })),
    [modes, t],
  );

  const handleModeChange = useCallback(
    (newMode: ResourceLocatorMode) => {
      onChange({ mode: newMode, value: "", cachedName: undefined });
      setDropdownOpen(false);
    },
    [onChange],
  );

  const handleIdChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange({ ...value, value: e.target.value });
    },
    [onChange, value],
  );

  const handleUrlChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      if (parseUrl) {
        const extracted = parseUrl(raw);
        onChange({ ...value, value: extracted ?? raw });
      } else {
        onChange({ ...value, value: raw });
      }
    },
    [onChange, parseUrl, value],
  );

  const handleSelect = useCallback(
    (opt: ResourceLocatorOption) => {
      onChange({ mode: "list", value: opt.id, cachedName: opt.name });
      setDropdownOpen(false);
    },
    [onChange],
  );

  const defaultPlaceholders: Record<ResourceLocatorMode, string> = {
    id: t("app.ndv.resourceLocator.placeholder.id"),
    url: t("app.ndv.resourceLocator.placeholder.url"),
    list: t("app.ndv.resourceLocator.placeholder.list"),
  };

  const ph = { ...defaultPlaceholders, ...placeholders };

  const listLabel =
    value.mode === "list" && value.cachedName
      ? `${value.cachedName}${value.value ? ` (${value.value.slice(0, 12)}${value.value.length > 12 ? "…" : ""})` : ""}`
      : t("app.ndv.resourceLocator.listTrigger.empty");

  return (
    <div
      className={[
        "gc-resource-locator",
        disabled ? "gc-resource-locator--disabled" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Mode picker */}
      <div className="gc-resource-locator__mode-row">
        <Select<ResourceLocatorMode>
          value={effectiveMode}
          onValueChange={handleModeChange}
          options={modeOptions}
          size="small"
          disabled={disabled}
          aria-label={t("app.ndv.resourceLocator.modePickerAriaLabel")}
          data-testid="rl-mode-select"
        />
      </div>

      {/* Input area */}
      <div className="gc-resource-locator__input-row">
        {effectiveMode === "id" && (
          <Input
            value={value.value}
            onChange={handleIdChange}
            placeholder={ph.id}
            disabled={disabled}
            aria-label={t("app.ndv.resourceLocator.idInput.ariaLabel")}
            data-testid="rl-id-input"
          />
        )}

        {effectiveMode === "url" && (
          <Input
            value={value.value}
            onChange={handleUrlChange}
            placeholder={ph.url}
            disabled={disabled}
            type="url"
            aria-label={t("app.ndv.resourceLocator.urlInput.ariaLabel")}
            data-testid="rl-url-input"
          />
        )}

        {effectiveMode === "list" && (
          <>
            <button
              ref={triggerRef}
              type="button"
              className="gc-resource-locator__list-trigger"
              disabled={disabled}
              onClick={() => setDropdownOpen((o) => !o)}
              aria-haspopup="listbox"
              aria-expanded={dropdownOpen}
              data-testid="rl-list-trigger"
            >
              <span className="gc-resource-locator__list-trigger-label">
                {listLabel}
              </span>
              <Icon name="chevron-down" size={14} />
            </button>

            <ResourceLocatorDropdown
              anchorRef={triggerRef}
              open={dropdownOpen}
              onClose={() => setDropdownOpen(false)}
              loadOptions={loadOptions}
              currentValue={value}
              onSelect={handleSelect}
              disabled={disabled}
            />
          </>
        )}
      </div>
    </div>
  );
}
