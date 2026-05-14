// Copyright GraphCaster. All Rights Reserved.

import { useTranslation } from "react-i18next";

import { Text } from "../../ui/Text/Text";
import {
  evaluateExpression,
  formatEvaluated,
  type EvaluationContext,
} from "../expression/evaluator";

export interface ExpressionResultStripProps {
  value: string;
  context: EvaluationContext;
}

export function ExpressionResultStrip({
  value,
  context,
}: ExpressionResultStripProps) {
  const { t } = useTranslation();

  if (typeof value !== "string" || !value.includes("{{")) {
    return null;
  }

  let result: ReturnType<typeof evaluateExpression>;
  try {
    result = evaluateExpression(value, context);
  } catch (err) {
    result = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (!result.ok) {
    return (
      <div
        className="gc-expr-result gc-expr-result--error"
        data-testid="expression-result-strip"
      >
        <Text size="xs" color="danger">
          {`⚠ ${result.error}`}
        </Text>
      </div>
    );
  }

  return (
    <div className="gc-expr-result" data-testid="expression-result-strip">
      <Text size="xs" color="secondary">
        {t("app.ndv.expression.resultLabel")}
      </Text>
      <Text size="xs">{formatEvaluated(result.value, 80)}</Text>
    </div>
  );
}
