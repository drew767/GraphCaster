// Copyright GraphCaster. All Rights Reserved.

import { useTranslation } from "react-i18next";

export const PER_PAGE_OPTIONS = [25, 50, 100] as const;

interface PaginationProps {
  page: number;
  perPage: number;
  total: number;
  onPageChange: (page: number) => void;
  onPerPageChange: (perPage: number) => void;
}

export function Pagination(props: PaginationProps): JSX.Element {
  const { page, perPage, total, onPageChange, onPerPageChange } = props;
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(Math.max(1, page), pages);
  const start = total === 0 ? 0 : (safePage - 1) * perPage + 1;
  const end = Math.min(total, safePage * perPage);

  return (
    <div
      data-testid="pagination"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 12px",
        borderTop: "1px solid var(--gc-border)",
        fontSize: 12,
        color: "var(--gc-text-secondary)",
      }}
    >
      <span data-testid="pagination-summary">
        {t("workflows.pagination.summary", { start, end, total })}
      </span>
      <span style={{ flex: 1 }} />
      <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {t("workflows.pagination.perPage")}
        <select
          data-testid="pagination-per-page"
          value={perPage}
          onChange={(e) => onPerPageChange(Number(e.target.value))}
          style={{
            padding: "2px 6px",
            border: "1px solid var(--gc-border)",
            borderRadius: "var(--gc-radius-sm)",
            fontSize: 12,
          }}
        >
          {PER_PAGE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        data-testid="pagination-prev"
        disabled={safePage <= 1}
        onClick={() => onPageChange(safePage - 1)}
        style={paginationBtnStyle(safePage <= 1)}
      >
        {t("workflows.pagination.prev")}
      </button>
      <span data-testid="pagination-page-info">
        {safePage} / {pages}
      </span>
      <button
        type="button"
        data-testid="pagination-next"
        disabled={safePage >= pages}
        onClick={() => onPageChange(safePage + 1)}
        style={paginationBtnStyle(safePage >= pages)}
      >
        {t("workflows.pagination.next")}
      </button>
    </div>
  );
}

function paginationBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "2px 8px",
    border: "1px solid var(--gc-border)",
    borderRadius: "var(--gc-radius-sm)",
    background: "var(--gc-surface-1)",
    color: disabled ? "var(--gc-text-secondary)" : "var(--gc-text-primary)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 12,
  };
}
