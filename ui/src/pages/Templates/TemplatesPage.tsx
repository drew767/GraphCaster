// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listTemplates, type TemplateMeta, type ListTemplatesOptions } from "../../api/templates";
import { EmptyState } from "../../components/ui/EmptyState/EmptyState";
import { Notice } from "../../components/ui/Notice/Notice";
import { Skeleton } from "../../components/ui/Skeleton/Skeleton";
import { TemplateCard } from "./TemplateCard";
import { TemplatePreviewModal } from "./TemplatePreviewModal";

type SortMode = "views" | "created";

export interface TemplatesPageProps {
  remoteUrl?: string | null;
  fetchFn?: typeof fetch;
  onCreateFromTemplate?: (template: TemplateMeta) => void | Promise<void>;
  onGraphCreated?: (graphId: string) => void;
}

export function TemplatesPage({
  remoteUrl,
  fetchFn,
  onCreateFromTemplate,
  onGraphCreated,
}: TemplatesPageProps = {}) {
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;

  const [allTemplates, setAllTemplates] = useState<TemplateMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [activeCategories, setActiveCategories] = useState<string[]>([]);
  const [sort, setSort] = useState<SortMode>("views");

  const [preview, setPreview] = useState<TemplateMeta | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    listTemplates(undefined, { remoteUrl, fetchFn })
      .then((data) => {
        if (!cancelled) {
          setAllTemplates(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(tRef.current("templates.loadError"));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [remoteUrl, fetchFn]);

  const categoryFacets = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tpl of allTemplates) {
      for (const cat of tpl.categories) {
        counts.set(cat, (counts.get(cat) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allTemplates]);

  const filteredTemplates = useMemo(() => {
    const opts: ListTemplatesOptions = {
      search: search.trim() || undefined,
      categories: activeCategories.length > 0 ? activeCategories : undefined,
      sort,
    };
    let list = allTemplates.slice();
    if (opts.search) {
      const q = opts.search.toLowerCase();
      list = list.filter((tpl) => {
        const hay = [tpl.name, tpl.description, ...(tpl.tags ?? []), ...tpl.categories]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }
    if (opts.categories) {
      const wanted = new Set(opts.categories);
      list = list.filter((tpl) => tpl.categories.some((c) => wanted.has(c)));
    }
    if (sort === "views") {
      list.sort((a, b) => b.views - a.views);
    } else {
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    return list;
  }, [allTemplates, search, activeCategories, sort]);

  const toggleCategory = useCallback((category: string) => {
    setActiveCategories((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category],
    );
  }, []);

  const clearFilters = useCallback(() => {
    setActiveCategories([]);
    setSearch("");
  }, []);

  const handleUseTemplate = useCallback(
    async (template: TemplateMeta) => {
      if (onCreateFromTemplate) {
        await onCreateFromTemplate(template);
      }
      onGraphCreated?.(template.id);
      setToastMessage(tRef.current("templates.created"));
      setPreview(null);
      window.setTimeout(() => setToastMessage(null), 3000);
    },
    [onCreateFromTemplate, onGraphCreated],
  );

  const filtersActive = activeCategories.length > 0 || search.trim().length > 0;

  return (
    <div className="gc-templates-page">
      <header className="gc-templates-page__header">
        <h1 className="gc-templates-page__title">{t("templates.title")}</h1>
        <input
          type="search"
          className="gc-templates-page__search"
          placeholder={t("templates.searchPlaceholder")}
          aria-label={t("templates.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </header>

      <div className="gc-templates-page__layout">
        <aside
          className="gc-templates-page__sidebar"
          aria-label={t("templates.facetsLabel")}
          style={{ width: 240 }}
        >
          <div className="gc-templates-page__sidebar-header">
            <h2 className="gc-templates-page__sidebar-title">
              {t("templates.categories")}
            </h2>
            {filtersActive && (
              <button
                type="button"
                className="gc-templates-page__clear"
                onClick={clearFilters}
              >
                {t("templates.clearFilters")}
              </button>
            )}
          </div>

          <ul className="gc-templates-page__facets" role="list">
            {categoryFacets.map((facet) => {
              const selected = activeCategories.includes(facet.label);
              return (
                <li key={facet.label}>
                  <label className="gc-templates-page__facet">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleCategory(facet.label)}
                      aria-label={facet.label}
                    />
                    <span className="gc-templates-page__facet-label">
                      {facet.label}
                    </span>
                    <span className="gc-templates-page__facet-count">
                      {facet.count}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          <fieldset className="gc-templates-page__sort">
            <legend className="gc-templates-page__sort-legend">
              {t("templates.sortBy")}
            </legend>
            <label className="gc-templates-page__sort-option">
              <input
                type="radio"
                name="gc-templates-sort"
                value="views"
                checked={sort === "views"}
                onChange={() => setSort("views")}
              />
              <span>{t("templates.sortMostViewed")}</span>
            </label>
            <label className="gc-templates-page__sort-option">
              <input
                type="radio"
                name="gc-templates-sort"
                value="created"
                checked={sort === "created"}
                onChange={() => setSort("created")}
              />
              <span>{t("templates.sortNewest")}</span>
            </label>
          </fieldset>
        </aside>

        <main className="gc-templates-page__main">
          {loading && (
            <div className="gc-templates-page__loading" role="status" aria-live="polite">
              <Skeleton height={120} count={6} />
            </div>
          )}

          {!loading && loadError && (
            <Notice type="error">{loadError}</Notice>
          )}

          {!loading && !loadError && filteredTemplates.length === 0 && (
            <EmptyState
              icon="layout-template"
              title={t("templates.empty.title")}
              description={t("templates.empty.description")}
              secondaryAction={{
                label: t("templates.clearFilters"),
                onClick: clearFilters,
              }}
            />
          )}

          {!loading && !loadError && filteredTemplates.length > 0 && (
            <div className="gc-templates-page__grid" role="list">
              {filteredTemplates.map((tpl) => (
                <div key={tpl.id} role="listitem">
                  <TemplateCard
                    template={tpl}
                    onPreview={setPreview}
                    onUse={(t) => void handleUseTemplate(t)}
                  />
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {preview && (
        <TemplatePreviewModal
          template={preview}
          onClose={() => setPreview(null)}
          onUse={handleUseTemplate}
        />
      )}

      {toastMessage && (
        <div className="gc-templates-page__toast" role="status" aria-live="polite">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
