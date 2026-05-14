// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "../../ui/Input/Input";
import { Select } from "../../ui/Select/Select";
import { Spinner } from "../../ui/Spinner/Spinner";

export type ResourceLocatorInputMode = "list" | "id" | "url";

export interface ResourceLocatorInputOption {
  value: string;
  label: string;
}

export interface ResourceLocatorInputSchema {
  type: "resourceLocator";
  modes?: ResourceLocatorInputMode[];
  optionsLoader?: (query: string) => Promise<ResourceLocatorInputOption[]>;
  /** Regex source string applied to URL → id; group 1 is the captured id. */
  urlExtractor?: string;
  defaultMode?: ResourceLocatorInputMode;
}

export interface ResourceLocatorInputValue {
  mode: ResourceLocatorInputMode;
  value: string;
}

export interface ResourceLocatorInputProps {
  schema: ResourceLocatorInputSchema;
  value: ResourceLocatorInputValue;
  onChange: (next: ResourceLocatorInputValue) => void;
  disabled?: boolean;
  placeholder?: string;
  "data-testid"?: string;
}

const DEFAULT_MODES: ResourceLocatorInputMode[] = ["list", "id", "url"];
const DEBOUNCE_MS = 250;

export function extractIdFromUrl(url: string, extractor?: string): string {
  if (!url) return url;
  if (!extractor) return url;
  try {
    const re = new RegExp(extractor);
    const m = re.exec(url);
    if (m && m[1] != null) return m[1];
    if (m && m[0] != null) return m[0];
  } catch {
    // ignore bad regex
  }
  return url;
}

export function ResourceLocatorInput({
  schema,
  value,
  onChange,
  disabled = false,
  placeholder,
  "data-testid": testId,
}: ResourceLocatorInputProps) {
  const { t } = useTranslation();
  const modes = schema.modes && schema.modes.length > 0 ? schema.modes : DEFAULT_MODES;
  const effectiveMode: ResourceLocatorInputMode =
    value?.mode ?? schema.defaultMode ?? modes[0] ?? "id";

  const modeOptions = useMemo(
    () =>
      modes.map((m) => ({
        value: m,
        label: t(`ndv.resourceLocator.mode.${m}`),
      })),
    [modes, t],
  );

  const handleModeChange = useCallback(
    (newMode: ResourceLocatorInputMode) => {
      onChange({ mode: newMode, value: "" });
    },
    [onChange],
  );

  const handleIdChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange({ mode: "id", value: e.target.value });
    },
    [onChange],
  );

  /* ── URL mode ─────────────────────────────────────────────── */
  const [urlDraft, setUrlDraft] = useState<string>(value?.value ?? "");
  useEffect(() => {
    if (effectiveMode === "url") {
      setUrlDraft(value?.value ?? "");
    }
  }, [effectiveMode, value?.value]);

  const handleUrlBlur = useCallback(() => {
    const extracted = extractIdFromUrl(urlDraft, schema.urlExtractor);
    onChange({ mode: "url", value: extracted });
  }, [urlDraft, schema.urlExtractor, onChange]);

  /* ── List mode (combobox) ─────────────────────────────────── */
  const [query, setQuery] = useState<string>("");
  const [options, setOptions] = useState<ResourceLocatorInputOption[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (effectiveMode !== "list") return;
    if (!schema.optionsLoader) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      const loader = schema.optionsLoader;
      if (!loader) {
        setLoading(false);
        return;
      }
      loader(query)
        .then((opts) => {
          setOptions(Array.isArray(opts) ? opts : []);
        })
        .catch(() => {
          setOptions([]);
        })
        .finally(() => {
          setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, effectiveMode, schema.optionsLoader]);

  return (
    <div
      className="gc-resource-locator-input"
      data-testid={testId ?? "resource-locator-input"}
    >
      <div className="gc-resource-locator-input__mode">
        <Select<ResourceLocatorInputMode>
          value={effectiveMode}
          onValueChange={handleModeChange}
          options={modeOptions}
          size="small"
          disabled={disabled}
          aria-label={t("ndv.resourceLocator.modeAriaLabel")}
          data-testid="rl-input-mode-chip"
        />
      </div>

      <div className="gc-resource-locator-input__field">
        {effectiveMode === "id" && (
          <Input
            value={value?.value ?? ""}
            onChange={handleIdChange}
            disabled={disabled}
            placeholder={placeholder ?? t("ndv.resourceLocator.idPlaceholder")}
            aria-label={t("ndv.resourceLocator.idAriaLabel")}
            data-testid="rl-input-id"
          />
        )}

        {effectiveMode === "url" && (
          <Input
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onBlur={handleUrlBlur}
            disabled={disabled}
            placeholder={placeholder ?? t("ndv.resourceLocator.urlPlaceholder")}
            aria-label={t("ndv.resourceLocator.urlAriaLabel")}
            data-testid="rl-input-url"
          />
        )}

        {effectiveMode === "list" && (
          <div className="gc-resource-locator-input__list" data-testid="rl-input-list">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={disabled}
              placeholder={t("ndv.resourceLocator.listPlaceholder")}
              aria-label={t("ndv.resourceLocator.listAriaLabel")}
              data-testid="rl-input-list-search"
            />
            {loading && (
              <div className="gc-resource-locator-input__loading" role="status" aria-live="polite">
                <Spinner size={14} />
                <span>{t("ndv.resourceLocator.loading")}</span>
              </div>
            )}
            {!loading && options.length > 0 && (
              <ul
                className="gc-resource-locator-input__options"
                role="listbox"
                aria-label={t("ndv.resourceLocator.listAriaLabel")}
              >
                {options.map((opt) => {
                  const selected = opt.value === value?.value;
                  return (
                    <li
                      key={opt.value}
                      role="option"
                      aria-selected={selected}
                      className={
                        selected
                          ? "gc-resource-locator-input__option gc-resource-locator-input__option--selected"
                          : "gc-resource-locator-input__option"
                      }
                      data-testid={`rl-input-option-${opt.value}`}
                      onClick={() => onChange({ mode: "list", value: opt.value })}
                    >
                      {opt.label}
                    </li>
                  );
                })}
              </ul>
            )}
            {!loading && options.length === 0 && query !== "" && (
              <div className="gc-resource-locator-input__empty">
                {t("ndv.resourceLocator.noMatches")}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
