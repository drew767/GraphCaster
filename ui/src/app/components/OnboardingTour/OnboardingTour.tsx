// Copyright GraphCaster. All Rights Reserved.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import "./OnboardingTour.css";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ONBOARDING_COMPLETED_KEY = "gc.onboarding.completed";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TourStep {
  /** Identifier for translation lookup: `onboarding.steps.<key>.title|body`. */
  key: string;
  /** Optional `data-tour` attribute value. Step is rendered centred when omitted. */
  target?: string;
}

export interface OnboardingTourProps {
  /** Force the tour to render regardless of localStorage state. */
  forceOpen?: boolean;
  /** Override the default step list. */
  steps?: TourStep[];
  /** Notified on completion / dismissal. */
  onClose?: (reason: "completed" | "skipped") => void;
  /** Inject storage for tests. */
  storage?: Pick<Storage, "getItem" | "setItem">;
}

// ---------------------------------------------------------------------------
// Default steps
// ---------------------------------------------------------------------------

const DEFAULT_STEPS: TourStep[] = [
  { key: "welcome" },
  { key: "sidebarWorkflows", target: "sidebar-workflows" },
  { key: "sidebarExecutions", target: "sidebar-executions" },
  { key: "canvasArea", target: "canvas-area" },
  { key: "runButton", target: "run-button" },
  { key: "userMenu", target: "user-menu" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function getRectFor(target: string | undefined): Rect | null {
  if (!target) return null;
  if (typeof document === "undefined") return null;
  const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function readDefaultStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function readCompleted(storage: Pick<Storage, "getItem" | "setItem"> | null): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(ONBOARDING_COMPLETED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCompleted(storage: Pick<Storage, "getItem" | "setItem"> | null): void {
  if (!storage) return;
  try {
    storage.setItem(ONBOARDING_COMPLETED_KEY, "1");
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const TOOLTIP_WIDTH = 320;
const TOOLTIP_OFFSET = 12;

export function OnboardingTour({
  forceOpen,
  steps,
  onClose,
  storage,
}: OnboardingTourProps) {
  const { t } = useTranslation();
  const resolvedSteps = useMemo(() => steps ?? DEFAULT_STEPS, [steps]);

  const effectiveStorage = useMemo(
    () => storage ?? readDefaultStorage(),
    [storage],
  );

  // Determine if the tour should render. Honour `forceOpen` first, then
  // fall back to the localStorage flag.
  const [open, setOpen] = useState<boolean>(() => {
    if (forceOpen) return true;
    return !readCompleted(effectiveStorage);
  });

  // Skip steps whose target is not present in the DOM. Recomputed when the
  // tour first opens so a missing target doesn't block progress.
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<Rect | null>(null);

  const advanceToVisibleStep = useCallback(
    (from: number, direction: 1 | -1): number => {
      let idx = from;
      while (idx >= 0 && idx < resolvedSteps.length) {
        const step = resolvedSteps[idx];
        if (!step.target) return idx;
        const rect = getRectFor(step.target);
        if (rect) return idx;
        idx += direction;
      }
      return -1;
    },
    [resolvedSteps],
  );

  useEffect(() => {
    if (!open) return;
    const next = advanceToVisibleStep(0, 1);
    if (next === -1) {
      setOpen(false);
      return;
    }
    setStepIndex(next);
  }, [open, advanceToVisibleStep]);

  // Track target rect (initial + on scroll/resize).
  useLayoutEffect(() => {
    if (!open) return;
    const step = resolvedSteps[stepIndex];
    if (!step) return;
    function refresh() {
      setTargetRect(getRectFor(step!.target));
    }
    refresh();
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);
    return () => {
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh, true);
    };
  }, [open, resolvedSteps, stepIndex]);

  const finish = useCallback(
    (reason: "completed" | "skipped") => {
      writeCompleted(effectiveStorage);
      setOpen(false);
      onClose?.(reason);
    },
    [effectiveStorage, onClose],
  );

  const handleNext = useCallback(() => {
    const next = advanceToVisibleStep(stepIndex + 1, 1);
    if (next === -1) {
      finish("completed");
    } else {
      setStepIndex(next);
    }
  }, [advanceToVisibleStep, stepIndex, finish]);

  const handleSkip = useCallback(() => finish("skipped"), [finish]);

  if (!open) return null;

  const step = resolvedSteps[stepIndex];
  if (!step) return null;

  const isLast = advanceToVisibleStep(stepIndex + 1, 1) === -1;
  const titleKey = `onboarding.steps.${step.key}.title`;
  const bodyKey = `onboarding.steps.${step.key}.body`;

  // Compute tooltip position. Centred for steps without a target.
  let tooltipStyle: React.CSSProperties;
  let highlightStyle: React.CSSProperties | null = null;

  if (step.target && targetRect) {
    const left = clampHoriz(
      targetRect.left + targetRect.width + TOOLTIP_OFFSET,
      TOOLTIP_WIDTH,
    );
    const top = Math.max(
      8,
      Math.min(
        (typeof window !== "undefined" ? window.innerHeight : 800) - 200,
        targetRect.top,
      ),
    );
    tooltipStyle = {
      position: "fixed",
      top: `${top}px`,
      left: `${left}px`,
      width: `${TOOLTIP_WIDTH}px`,
    };
    highlightStyle = {
      position: "fixed",
      top: `${targetRect.top - 4}px`,
      left: `${targetRect.left - 4}px`,
      width: `${targetRect.width + 8}px`,
      height: `${targetRect.height + 8}px`,
    };
  } else {
    tooltipStyle = {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      width: `${TOOLTIP_WIDTH}px`,
    };
  }

  const titleId = `gc-onboarding-step-title-${step.key}`;

  const content = (
    <div
      className="gc-onboarding-tour"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="onboarding-tour"
    >
      <div className="gc-onboarding-tour__backdrop" />
      {highlightStyle && (
        <div
          className="gc-onboarding-tour__highlight"
          style={highlightStyle}
          data-testid="onboarding-tour-highlight"
        />
      )}
      <div
        className="gc-onboarding-tour__tooltip"
        style={tooltipStyle}
        data-testid="onboarding-tour-tooltip"
      >
        <div className="gc-onboarding-tour__title" id={titleId}>
          {t(titleKey)}
        </div>
        <div className="gc-onboarding-tour__body">{t(bodyKey)}</div>
        <div className="gc-onboarding-tour__actions">
          <button
            type="button"
            className="gc-onboarding-tour__skip"
            onClick={handleSkip}
            data-testid="onboarding-tour-skip"
          >
            {t("onboarding.skip")}
          </button>
          <button
            type="button"
            className="gc-onboarding-tour__next"
            onClick={handleNext}
            data-testid="onboarding-tour-next"
            autoFocus
          >
            {t(isLast ? "onboarding.finish" : "onboarding.next")}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return content;
  return createPortal(content, document.body);
}

function clampHoriz(desired: number, width: number): number {
  if (typeof window === "undefined") return desired;
  const max = window.innerWidth - width - 8;
  return Math.max(8, Math.min(max, desired));
}
