// Copyright GraphCaster. All Rights Reserved.

export interface ParameterDisplayOptions {
  show?: Record<string, unknown[]>;
  hide?: Record<string, unknown[]>;
}

export interface VisibilityCandidate {
  displayOptions?: ParameterDisplayOptions;
}

/**
 * Decide whether a parameter is visible given current sibling values.
 *
 * Rules:
 * - If `displayOptions.show` is defined, every listed key must have its current
 *   value contained in the allow-list.
 * - If `displayOptions.hide` is defined, no listed key may have its current
 *   value contained in the deny-list.
 * - Missing `displayOptions` ⇒ always visible.
 */
export function isVisible(
  param: VisibilityCandidate,
  currentValues: Record<string, unknown>,
): boolean {
  const opts = param.displayOptions;
  if (!opts) return true;

  const { show, hide } = opts;
  if (show) {
    for (const key of Object.keys(show)) {
      const allowed = show[key];
      if (!Array.isArray(allowed) || !allowed.includes(currentValues[key])) {
        return false;
      }
    }
  }
  if (hide) {
    for (const key of Object.keys(hide)) {
      const denied = hide[key];
      if (Array.isArray(denied) && denied.includes(currentValues[key])) {
        return false;
      }
    }
  }
  return true;
}
