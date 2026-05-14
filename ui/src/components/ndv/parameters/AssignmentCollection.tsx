// Copyright GraphCaster. All Rights Reserved.

import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../ui/Button/Button";
import { Input } from "../../ui/Input/Input";
import { Select } from "../../ui/Select/Select";
import { Switch } from "../../ui/Switch/Switch";
import "./ParameterTypes.css";

export type AssignmentOperation = "set" | "rename" | "keep" | "drop";

export interface Assignment {
  key: string;
  operation: AssignmentOperation;
  /** Present for set / rename. */
  value?: string;
  /** Whether `value` is an expression (or a plain string). */
  expression?: boolean;
}

export interface AssignmentCollectionProps {
  value: Assignment[];
  onChange: (value: Assignment[]) => void;
  disabled?: boolean;
}

function operationHasValue(op: AssignmentOperation): boolean {
  return op === "set" || op === "rename";
}

function normalizeAssignment(a: Assignment): Assignment {
  if (operationHasValue(a.operation)) {
    return {
      key: a.key,
      operation: a.operation,
      value: a.value ?? "",
      expression: a.expression ?? false,
    };
  }
  return { key: a.key, operation: a.operation };
}

export function AssignmentCollection({
  value,
  onChange,
  disabled = false,
}: AssignmentCollectionProps) {
  const { t } = useTranslation();

  const operationOptions = [
    { value: "set", label: t("app.ndv.parameters.types.assignmentCollection.operation.set") },
    { value: "rename", label: t("app.ndv.parameters.types.assignmentCollection.operation.rename") },
    { value: "keep", label: t("app.ndv.parameters.types.assignmentCollection.operation.keep") },
    { value: "drop", label: t("app.ndv.parameters.types.assignmentCollection.operation.drop") },
  ];

  const updateRow = useCallback(
    (idx: number, next: Assignment) => {
      const copy = value.slice();
      copy[idx] = normalizeAssignment(next);
      onChange(copy);
    },
    [value, onChange],
  );

  const addRow = useCallback(() => {
    onChange([
      ...value,
      normalizeAssignment({ key: "", operation: "set", value: "", expression: false }),
    ]);
  }, [value, onChange]);

  const removeRow = useCallback(
    (idx: number) => {
      const copy = value.slice();
      copy.splice(idx, 1);
      onChange(copy);
    },
    [value, onChange],
  );

  return (
    <div className="gc-param-assignments" data-testid="param-assignments">
      <div className="gc-param-assignments__rows">
        {value.map((row, idx) => {
          const showValue = operationHasValue(row.operation);
          return (
            <div
              key={idx}
              className="gc-param-assignments__row"
              data-testid={`param-assignments-row-${idx}`}
            >
              <Input
                value={row.key}
                onChange={(e) =>
                  updateRow(idx, { ...row, key: e.target.value })
                }
                placeholder={t("app.ndv.parameters.types.assignmentCollection.keyPlaceholder")}
                disabled={disabled}
                aria-label={t("app.ndv.parameters.types.assignmentCollection.keyPlaceholder")}
                data-testid={`param-assignments-key-${idx}`}
              />
              <Select
                value={row.operation}
                onValueChange={(op) =>
                  updateRow(idx, {
                    ...row,
                    operation: op as AssignmentOperation,
                  })
                }
                options={operationOptions}
                disabled={disabled}
                aria-label="operation"
                data-testid={`param-assignments-op-${idx}`}
              />
              {showValue && (
                <>
                  <Input
                    value={row.value ?? ""}
                    onChange={(e) =>
                      updateRow(idx, { ...row, value: e.target.value })
                    }
                    placeholder={t("app.ndv.parameters.types.assignmentCollection.valuePlaceholder")}
                    disabled={disabled}
                    aria-label={t("app.ndv.parameters.types.assignmentCollection.valuePlaceholder")}
                    data-testid={`param-assignments-value-${idx}`}
                  />
                  <Switch
                    checked={row.expression ?? false}
                    onCheckedChange={(b) =>
                      updateRow(idx, { ...row, expression: b })
                    }
                    disabled={disabled}
                    label={t("app.ndv.parameters.types.assignmentCollection.expressionToggle")}
                    data-testid={`param-assignments-expr-${idx}`}
                  />
                </>
              )}
              <Button
                variant="ghost"
                size="xsmall"
                onClick={() => removeRow(idx)}
                disabled={disabled}
                data-testid={`param-assignments-remove-${idx}`}
              >
                {t("app.ndv.parameters.types.assignmentCollection.removeAssignment")}
              </Button>
            </div>
          );
        })}
      </div>
      <div className="gc-param-assignments__footer">
        <Button
          variant="ghost"
          size="small"
          iconLeft="plus"
          onClick={addRow}
          disabled={disabled}
          data-testid="param-assignments-add"
        >
          {t("app.ndv.parameters.types.assignmentCollection.addAssignment")}
        </Button>
      </div>
    </div>
  );
}

export default AssignmentCollection;
void React;
