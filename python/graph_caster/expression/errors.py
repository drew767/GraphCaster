# Copyright GraphCaster. All Rights Reserved.

"""Expression engine error types."""


class ExpressionError(Exception):
    """Base class for expression errors."""


class ExpressionSyntaxError(ExpressionError):
    """Raised when expression syntax is invalid."""

    def __init__(self, message: str, position: int | None = None):
        self.position = position
        super().__init__(message)


class ExpressionEvaluationError(ExpressionError):
    """Raised when expression evaluation fails."""

    def __init__(self, message: str, expression: str):
        self.expression = expression
        super().__init__(f"{message} in expression: {expression}")


class ExpressionTimeoutError(ExpressionEvaluationError):
    """Raised when evaluation exceeds the configured wall-clock limit."""

    def __init__(self, message: str, expression: str):
        super().__init__(message, expression)


class UndefinedVariableError(ExpressionEvaluationError):
    """Raised when referencing undefined variable."""

    def __init__(self, message: str, expression: str = ""):
        super().__init__(message, expression)


class ForbiddenOperationError(ExpressionError):
    """Raised when expression uses forbidden operation."""
