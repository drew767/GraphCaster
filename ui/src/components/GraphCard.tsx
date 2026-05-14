// Copyright GraphCaster. All Rights Reserved.

import { useTranslation } from "react-i18next";

export type GraphCardProps = {
  graphId: string;
  title: string;
  fileName: string;
  thumbnailUrl?: string | null;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
};

export function GraphCard({
  graphId,
  title,
  fileName,
  thumbnailUrl,
  selected = false,
  disabled = false,
  onClick,
}: GraphCardProps) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      className={`gc-graph-card${selected ? " gc-graph-card--selected" : ""}`}
      disabled={disabled}
      onClick={onClick}
    >
      <div className="gc-graph-card__thumb">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={title}
            className="gc-graph-card__thumb-img"
            draggable={false}
          />
        ) : (
          <span className="gc-graph-card__thumb-placeholder" aria-label={t("app.thumbnail.noThumbnail")}>
            <span className="gc-graph-card__thumb-glyph" aria-hidden="true" />
          </span>
        )}
      </div>
      <span className="gc-graph-card__title">
        {title !== "" ? title : fileName}
      </span>
      <span className="gc-graph-card__file">{fileName}</span>
      <span className="gc-graph-card__id">{graphId}</span>
    </button>
  );
}
