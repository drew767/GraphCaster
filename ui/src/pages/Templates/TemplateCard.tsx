// Copyright GraphCaster. All Rights Reserved.

import { useTranslation } from "react-i18next";
import type { TemplateMeta } from "../../api/templates";

interface TemplateCardProps {
  template: TemplateMeta;
  onPreview: (template: TemplateMeta) => void;
  onUse: (template: TemplateMeta) => void;
}

export function TemplateCard({ template, onPreview, onUse }: TemplateCardProps) {
  const { t } = useTranslation();

  return (
    <div className="gc-template-card" data-testid="template-card">
      <div
        className="gc-template-card__preview"
        role="button"
        tabIndex={0}
        aria-label={template.name}
        onClick={() => onPreview(template)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onPreview(template);
        }}
      >
        {template.coverUrl ? (
          <img
            src={template.coverUrl}
            alt={template.name}
            className="gc-template-card__img"
          />
        ) : (
          <div className="gc-template-card__placeholder" aria-hidden="true" />
        )}
      </div>

      <div className="gc-template-card__body">
        <h3 className="gc-template-card__title">{template.name}</h3>
        <p className="gc-template-card__description">{template.description}</p>

        <div className="gc-template-card__meta">
          <span className="gc-template-card__author">{template.author.name}</span>
          <span className="gc-template-card__views" aria-label={t("templates.viewsLabel")}>
            {t("templates.viewsCount", { count: template.views })}
          </span>
        </div>

        {template.categories.length > 0 && (
          <div className="gc-template-card__chips" aria-label={t("templates.categories")}>
            {template.categories.map((cat) => (
              <span key={cat} className="gc-template-card__chip">
                {cat}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="gc-template-card__actions">
        <button
          className="gc-template-card__btn gc-template-card__btn--preview"
          onClick={() => onPreview(template)}
          type="button"
        >
          {t("templates.preview")}
        </button>
        <button
          className="gc-template-card__btn gc-template-card__btn--use"
          onClick={() => onUse(template)}
          type="button"
        >
          {t("templates.useTemplate")}
        </button>
      </div>
    </div>
  );
}
