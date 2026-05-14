// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  ONBOARDING_COMPLETED_KEY,
  OnboardingTour,
  type TourStep,
} from "./OnboardingTour";

// ---------------------------------------------------------------------------
// Stubs / mocks
// ---------------------------------------------------------------------------

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "onboarding.skip": "Skip tour",
        "onboarding.next": "Next",
        "onboarding.finish": "Got it",
        "onboarding.steps.welcome.title": "Welcome to GraphCaster",
        "onboarding.steps.welcome.body": "Let's take a quick tour.",
        "onboarding.steps.sidebar.title": "Sidebar",
        "onboarding.steps.sidebar.body": "Browse workflows here.",
        "onboarding.steps.canvas.title": "Canvas",
        "onboarding.steps.canvas.body": "Drop nodes here.",
      };
      return map[key] ?? key;
    },
  }),
}));

function memStorage(): Pick<Storage, "getItem" | "setItem"> & {
  store: Record<string, string>;
} {
  const store: Record<string, string> = {};
  return {
    store,
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OnboardingTour", () => {
  let storage: ReturnType<typeof memStorage>;

  beforeEach(() => {
    storage = memStorage();
  });

  it("shows the first step on first run", () => {
    const steps: TourStep[] = [{ key: "welcome" }];
    render(<OnboardingTour steps={steps} storage={storage} />);
    expect(screen.getByTestId("onboarding-tour")).toBeInTheDocument();
    expect(screen.getByText("Welcome to GraphCaster")).toBeInTheDocument();
  });

  it("does not show when completed flag is set", () => {
    storage.setItem(ONBOARDING_COMPLETED_KEY, "1");
    const steps: TourStep[] = [{ key: "welcome" }];
    render(<OnboardingTour steps={steps} storage={storage} />);
    expect(screen.queryByTestId("onboarding-tour")).not.toBeInTheDocument();
  });

  it("advances through steps with Next button and sets completed flag at end", () => {
    const onClose = vi.fn();
    const steps: TourStep[] = [
      { key: "welcome" },
      { key: "sidebar" }, // no target, will render centered
    ];

    render(
      <OnboardingTour steps={steps} storage={storage} onClose={onClose} />,
    );

    expect(screen.getByText("Welcome to GraphCaster")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("onboarding-tour-next"));
    expect(screen.getByText("Sidebar")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("onboarding-tour-next"));
    expect(screen.queryByTestId("onboarding-tour")).not.toBeInTheDocument();

    expect(storage.store[ONBOARDING_COMPLETED_KEY]).toBe("1");
    expect(onClose).toHaveBeenCalledWith("completed");
  });

  it("Skip closes the tour and sets completed flag", () => {
    const onClose = vi.fn();
    const steps: TourStep[] = [{ key: "welcome" }, { key: "sidebar" }];

    render(
      <OnboardingTour steps={steps} storage={storage} onClose={onClose} />,
    );

    fireEvent.click(screen.getByTestId("onboarding-tour-skip"));
    expect(screen.queryByTestId("onboarding-tour")).not.toBeInTheDocument();
    expect(storage.store[ONBOARDING_COMPLETED_KEY]).toBe("1");
    expect(onClose).toHaveBeenCalledWith("skipped");
  });

  it("skips steps whose data-tour target is missing", () => {
    const steps: TourStep[] = [
      { key: "welcome" },
      { key: "sidebar", target: "does-not-exist" },
      { key: "canvas" },
    ];
    render(<OnboardingTour steps={steps} storage={storage} />);
    fireEvent.click(screen.getByTestId("onboarding-tour-next"));
    expect(screen.getByText("Canvas")).toBeInTheDocument();
  });

  it("highlights a step when its target element exists", () => {
    const div = document.createElement("div");
    div.setAttribute("data-tour", "real-target");
    document.body.appendChild(div);

    const steps: TourStep[] = [
      { key: "sidebar", target: "real-target" },
    ];

    render(<OnboardingTour steps={steps} storage={storage} />);
    expect(screen.getByTestId("onboarding-tour-highlight")).toBeInTheDocument();

    div.remove();
  });
});
