// Copyright GraphCaster. All Rights Reserved.

import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../ui/Button/Button";
import { Input } from "../../ui/Input/Input";
import { Select } from "../../ui/Select/Select";
import "./ParameterTypes.css";

export type FilterOperator =
  | "eq"
  | "neq"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "isEmpty"
  | "isNotEmpty"
  | "regex";

export type FilterCombinator = "and" | "or";

export interface FilterRule {
  left: string;
  operator: FilterOperator;
  right: string;
}

export interface FilterGroup {
  combinator: FilterCombinator;
  rules: Array<FilterRule | FilterGroup>;
}

export interface FilterRuleBuilderProps {
  value: FilterGroup;
  onChange: (value: FilterGroup) => void;
  disabled?: boolean;
  /** Internal: how deep we are (limits nesting). */
  depth?: number;
  /** Internal: maximum nesting depth. Default 1 = one level of nested groups allowed. */
  maxDepth?: number;
  testIdPrefix?: string;
}

const OPERATORS_WITHOUT_RIGHT: FilterOperator[] = ["isEmpty", "isNotEmpty"];

export const DEFAULT_FILTER_VALUE: FilterGroup = {
  combinator: "and",
  rules: [],
};

function isGroup(node: FilterRule | FilterGroup): node is FilterGroup {
  return (node as FilterGroup).combinator !== undefined;
}

function defaultRule(): FilterRule {
  return { left: "", operator: "eq", right: "" };
}

function defaultGroup(): FilterGroup {
  return { combinator: "and", rules: [defaultRule()] };
}

export function FilterRuleBuilder({
  value,
  onChange,
  disabled = false,
  depth = 0,
  maxDepth = 1,
  testIdPrefix = "filter-rule",
}: FilterRuleBuilderProps) {
  const { t } = useTranslation();

  const operatorOptions = [
    { value: "eq", label: t("app.ndv.parameters.types.filter.operator.eq") },
    { value: "neq", label: t("app.ndv.parameters.types.filter.operator.neq") },
    { value: "lt", label: t("app.ndv.parameters.types.filter.operator.lt") },
    { value: "lte", label: t("app.ndv.parameters.types.filter.operator.lte") },
    { value: "gt", label: t("app.ndv.parameters.types.filter.operator.gt") },
    { value: "gte", label: t("app.ndv.parameters.types.filter.operator.gte") },
    { value: "contains", label: t("app.ndv.parameters.types.filter.operator.contains") },
    { value: "startsWith", label: t("app.ndv.parameters.types.filter.operator.startsWith") },
    { value: "endsWith", label: t("app.ndv.parameters.types.filter.operator.endsWith") },
    { value: "isEmpty", label: t("app.ndv.parameters.types.filter.operator.isEmpty") },
    { value: "isNotEmpty", label: t("app.ndv.parameters.types.filter.operator.isNotEmpty") },
    { value: "regex", label: t("app.ndv.parameters.types.filter.operator.regex") },
  ];

  const combinatorOptions = [
    { value: "and", label: t("app.ndv.parameters.types.filter.combinator.and") },
    { value: "or", label: t("app.ndv.parameters.types.filter.combinator.or") },
  ];

  const updateRule = useCallback(
    (idx: number, updater: (r: FilterRule | FilterGroup) => FilterRule | FilterGroup) => {
      const rules = value.rules.slice();
      rules[idx] = updater(rules[idx]);
      onChange({ ...value, rules });
    },
    [value, onChange],
  );

  const addCondition = useCallback(() => {
    onChange({ ...value, rules: [...value.rules, defaultRule()] });
  }, [value, onChange]);

  const addGroup = useCallback(() => {
    onChange({ ...value, rules: [...value.rules, defaultGroup()] });
  }, [value, onChange]);

  const removeAt = useCallback(
    (idx: number) => {
      const rules = value.rules.slice();
      rules.splice(idx, 1);
      onChange({ ...value, rules });
    },
    [value, onChange],
  );

  const setCombinator = useCallback(
    (c: FilterCombinator) => {
      onChange({ ...value, combinator: c });
    },
    [value, onChange],
  );

  const canAddGroup = depth < maxDepth;

  return (
    <div
      className="gc-param-filter"
      data-testid={`${testIdPrefix}-group-${depth}`}
    >
      <div className="gc-param-filter__header">
        <Select
          value={value.combinator}
          onValueChange={(v) => setCombinator(v as FilterCombinator)}
          options={combinatorOptions}
          disabled={disabled}
          aria-label={t("app.ndv.parameters.types.filter.combinator.and")}
          data-testid={`${testIdPrefix}-combinator-${depth}`}
        />
      </div>

      <div className="gc-param-filter__rules">
        {value.rules.map((r, idx) => {
          if (isGroup(r)) {
            return (
              <div
                key={idx}
                className="gc-param-filter__nested"
                data-testid={`${testIdPrefix}-nested-${depth}-${idx}`}
              >
                <FilterRuleBuilder
                  value={r}
                  onChange={(next) =>
                    updateRule(idx, () => next)
                  }
                  disabled={disabled}
                  depth={depth + 1}
                  maxDepth={maxDepth}
                  testIdPrefix={`${testIdPrefix}-${idx}`}
                />
                <Button
                  variant="ghost"
                  size="xsmall"
                  onClick={() => removeAt(idx)}
                  disabled={disabled}
                  data-testid={`${testIdPrefix}-remove-group-${depth}-${idx}`}
                >
                  {t("app.ndv.parameters.types.filter.removeGroup")}
                </Button>
              </div>
            );
          }
          const rule = r as FilterRule;
          const hideRight = OPERATORS_WITHOUT_RIGHT.includes(rule.operator);
          return (
            <div
              key={idx}
              className="gc-param-filter__rule"
              data-testid={`${testIdPrefix}-row-${depth}-${idx}`}
            >
              <Input
                value={rule.left}
                onChange={(e) =>
                  updateRule(idx, (cur) => ({
                    ...(cur as FilterRule),
                    left: e.target.value,
                  }))
                }
                placeholder={t("app.ndv.parameters.types.filter.leftPlaceholder")}
                disabled={disabled}
                aria-label={t("app.ndv.parameters.types.filter.leftPlaceholder")}
                data-testid={`${testIdPrefix}-left-${depth}-${idx}`}
              />
              <Select
                value={rule.operator}
                onValueChange={(op) =>
                  updateRule(idx, (cur) => ({
                    ...(cur as FilterRule),
                    operator: op as FilterOperator,
                  }))
                }
                options={operatorOptions}
                disabled={disabled}
                aria-label="operator"
                data-testid={`${testIdPrefix}-op-${depth}-${idx}`}
              />
              {!hideRight && (
                <Input
                  value={rule.right}
                  onChange={(e) =>
                    updateRule(idx, (cur) => ({
                      ...(cur as FilterRule),
                      right: e.target.value,
                    }))
                  }
                  placeholder={t("app.ndv.parameters.types.filter.rightPlaceholder")}
                  disabled={disabled}
                  aria-label={t("app.ndv.parameters.types.filter.rightPlaceholder")}
                  data-testid={`${testIdPrefix}-right-${depth}-${idx}`}
                />
              )}
              <Button
                variant="ghost"
                size="xsmall"
                onClick={() => removeAt(idx)}
                disabled={disabled}
                data-testid={`${testIdPrefix}-remove-${depth}-${idx}`}
              >
                {t("app.ndv.parameters.types.filter.removeCondition")}
              </Button>
            </div>
          );
        })}
      </div>

      <div className="gc-param-filter__actions">
        <Button
          variant="ghost"
          size="small"
          iconLeft="plus"
          onClick={addCondition}
          disabled={disabled}
          data-testid={`${testIdPrefix}-add-condition-${depth}`}
        >
          {t("app.ndv.parameters.types.filter.addCondition")}
        </Button>
        {canAddGroup && (
          <Button
            variant="ghost"
            size="small"
            iconLeft="plus"
            onClick={addGroup}
            disabled={disabled}
            data-testid={`${testIdPrefix}-add-group-${depth}`}
          >
            {t("app.ndv.parameters.types.filter.addGroup")}
          </Button>
        )}
      </div>
    </div>
  );
}

export default FilterRuleBuilder;
void React;
