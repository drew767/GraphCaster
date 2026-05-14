// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { useTranslation } from "react-i18next";

import { Select, type SelectOption } from "../../components/ui";

export interface ExecutionsFilterValue {
  graphId: string;
  status: string;
  since: string;
  until: string;
  metaKey: string;
  metaValue: string;
}

export interface GraphOption {
  id: string;
  name: string;
}

export interface ExecutionsFilterProps {
  value: ExecutionsFilterValue;
  onChange: (next: ExecutionsFilterValue) => void;
  graphs?: GraphOption[];
}

const ALL_SENTINEL = "__all__";

const STATUS_OPTIONS: SelectOption[] = [
  { value: ALL_SENTINEL, label: "All statuses" },
  { value: "success", label: "Success" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "running", label: "Running" },
  { value: "waiting", label: "Waiting" },
  { value: "queued", label: "Queued" },
];

function toSelect(val: string): string {
  return val === "" ? ALL_SENTINEL : val;
}

function fromSelect(val: string): string {
  return val === ALL_SENTINEL ? "" : val;
}

export function ExecutionsFilter({
  value,
  onChange,
  graphs = [],
}: ExecutionsFilterProps) {
  const { t } = useTranslation();

  const graphOptions: SelectOption[] = [
    {
      value: ALL_SENTINEL,
      label: t("app.executions.filters.allWorkflows", "All workflows"),
    },
    ...graphs.map((g) => ({ value: g.id, label: g.name })),
  ];

  function patch(partial: Partial<ExecutionsFilterValue>) {
    onChange({ ...value, ...partial });
  }

  return (
    <div
      className="gc-executions-filter"
      role="search"
      aria-label={t("app.executions.filters.ariaLabel", "Execution filters")}
    >
      <Select
        value={toSelect(value.graphId)}
        onValueChange={(v) => patch({ graphId: fromSelect(v) })}
        options={graphOptions}
        searchable
        placeholder={t("app.executions.filters.workflow", "Workflow")}
        aria-label={t("app.executions.filters.workflow", "Workflow")}
        data-testid="filter-graph"
      />

      <Select
        value={toSelect(value.status)}
        onValueChange={(v) => patch({ status: fromSelect(v) })}
        options={STATUS_OPTIONS}
        placeholder={t("app.executions.filters.status", "Status")}
        aria-label={t("app.executions.filters.status", "Status")}
        data-testid="filter-status"
      />

      <input
        className="gc-input gc-input--medium"
        type="date"
        value={value.since}
        onChange={(e) => patch({ since: e.target.value })}
        placeholder={t("app.executions.filters.from", "From")}
        aria-label={t("app.executions.filters.from", "From")}
        data-testid="filter-since"
      />

      <input
        className="gc-input gc-input--medium"
        type="date"
        value={value.until}
        onChange={(e) => patch({ until: e.target.value })}
        placeholder={t("app.executions.filters.to", "To")}
        aria-label={t("app.executions.filters.to", "To")}
        data-testid="filter-until"
      />

      <div className="gc-executions-filter__meta">
        <input
          className="gc-input gc-input--medium"
          value={value.metaKey}
          onChange={(e) => patch({ metaKey: e.target.value })}
          placeholder={t("app.executions.filters.metaKey", "Metadata key")}
          aria-label={t("app.executions.filters.metaKey", "Metadata key")}
          data-testid="filter-meta-key"
        />
        <input
          className="gc-input gc-input--medium"
          value={value.metaValue}
          onChange={(e) => patch({ metaValue: e.target.value })}
          placeholder={t("app.executions.filters.metaValue", "Metadata value")}
          aria-label={t("app.executions.filters.metaValue", "Metadata value")}
          data-testid="filter-meta-value"
        />
      </div>
    </div>
  );
}
