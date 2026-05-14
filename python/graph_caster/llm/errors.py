# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations


class LLMError(Exception):
    """Base class for all typed LLM provider errors."""

    def __init__(self, message: str = "", *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class LLMRateLimitError(LLMError):
    """HTTP 429 — rate limit reached."""


class LLMQuotaExceededError(LLMError):
    """Provider-specific quota / billing limit exceeded."""


class LLMServerError(LLMError):
    """HTTP 5xx — server-side error."""


class LLMTimeoutError(LLMError):
    """Request timed out (httpx.TimeoutException)."""


class LLMBadRequestError(LLMError):
    """HTTP 4xx other than rate-limit / auth."""


class LLMAuthError(LLMError):
    """HTTP 401 / 403 — authentication or authorisation failure."""
