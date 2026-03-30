# Copyright GraphCaster. All Rights Reserved.

"""Template string rendering with embedded expressions."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from .context import ExpressionContextDict
from .errors import ExpressionError
from .evaluator import ExpressionEvaluator

logger = logging.getLogger(__name__)

TEMPLATE_PATTERN = re.compile(r"\$?\{\{\s*(.+?)\s*\}\}")

_evaluator = ExpressionEvaluator()


def render_template(
    template: str,
    context: ExpressionContextDict,
    *,
    error_placeholder: str = "<ERROR>",
) -> str:
    if not template:
        return template

    def replace_match(match: re.Match[str]) -> str:
        expression = match.group(1)
        try:
            result = _evaluator.evaluate(expression, context)
            if result is None:
                return ""
            if isinstance(result, bool):
                return "true" if result else "false"
            if isinstance(result, (dict, list)):
                return json.dumps(result, separators=(",", ":"))
            return str(result)
        except ExpressionError as e:
            logger.warning("Template expression failed: %s (expression: %s)", e, expression)
            return error_placeholder
        except Exception as e:
            logger.error("Unexpected error in template expression: %s (expression: %s)", e, expression)
            return error_placeholder

    return TEMPLATE_PATTERN.sub(replace_match, template)


def extract_expressions(template: str) -> list[str]:
    if not template:
        return []
    return TEMPLATE_PATTERN.findall(template)


def has_expressions(template: str) -> bool:
    if not template:
        return False
    return bool(TEMPLATE_PATTERN.search(template))
