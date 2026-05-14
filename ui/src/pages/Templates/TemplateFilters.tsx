// Copyright GraphCaster. All Rights Reserved.

import { useTranslation } from "react-i18next";

interface TemplateFiltersProps {
  frameworks: string[];
  usecases: string[];
  tags: string[];
  selectedFramework: string;
  selectedUsecase: string;
  selectedTag: string;
  onFrameworkChange: (v: string) => void;
  onUsecaseChange: (v: string) => void;
  onTagChange: (v: string) => void;
}

export function TemplateFilters({
  frameworks,
  usecases,
  tags,
  selectedFramework,
  selectedUsecase,
  selectedTag,
  onFrameworkChange,
  onUsecaseChange,
  onTagChange,
}: TemplateFiltersProps) {
  const { t } = useTranslation();

  return (
    <aside className="gc-template-filters" aria-label={t("app.marketplace.templates")}>
      <div className="gc-template-filters__group">
        <label className="gc-template-filters__label" htmlFor="gc-filter-framework">
          {t("app.marketplace.filterByFramework")}
        </label>
        <select
          id="gc-filter-framework"
          className="gc-template-filters__select"
          value={selectedFramework}
          onChange={(e) => onFrameworkChange(e.target.value)}
        >
          <option value="">{t("app.marketplace.allFrameworks")}</option>
          {frameworks.map((fw) => (
            <option key={fw} value={fw}>
              {fw}
            </option>
          ))}
        </select>
      </div>

      <div className="gc-template-filters__group">
        <label className="gc-template-filters__label" htmlFor="gc-filter-usecase">
          {t("app.marketplace.filterByUseCase")}
        </label>
        <select
          id="gc-filter-usecase"
          className="gc-template-filters__select"
          value={selectedUsecase}
          onChange={(e) => onUsecaseChange(e.target.value)}
        >
          <option value="">{t("app.marketplace.allUseCases")}</option>
          {usecases.map((uc) => (
            <option key={uc} value={uc}>
              {uc}
            </option>
          ))}
        </select>
      </div>

      <div className="gc-template-filters__group">
        <label className="gc-template-filters__label" htmlFor="gc-filter-tag">
          {t("app.marketplace.filterByTag")}
        </label>
        <select
          id="gc-filter-tag"
          className="gc-template-filters__select"
          value={selectedTag}
          onChange={(e) => onTagChange(e.target.value)}
        >
          <option value="">{t("app.marketplace.allTags")}</option>
          {tags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
      </div>
    </aside>
  );
}
