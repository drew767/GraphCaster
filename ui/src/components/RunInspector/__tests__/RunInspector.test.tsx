// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import { NodeStepCard } from "../NodeStepCard";
import type { NodeStep } from "../traceTree";

const i18n = i18next.createInstance();
void i18n.use(initReactI18next).init({
  lng: "en",
  resources: {
    en: {
      translation: {
        "app.runInspector.status.running": "Running",
        "app.runInspector.status.done": "Done",
        "app.runInspector.status.error": "Error",
        "app.runInspector.status.cached": "Cached",
        "app.runInspector.status.cancelled": "Cancelled",
        "app.runInspector.inputs": "Inputs",
        "app.runInspector.outputs": "Outputs",
        "app.runInspector.replayFromHere": "Replay from here",
        "app.runInspector.noErrors": "No errors",
      },
    },
  },
});

function makeStep(overrides: Partial<NodeStep> = {}): NodeStep {
  return {
    nodeId: "node-1",
    type: "task",
    status: "done",
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_000_500,
    durationMs: 500,
    inputs: null,
    outputs: null,
    rawEvents: [],
    ...overrides,
  };
}

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

describe("NodeStepCard", () => {
  it("renders node id and type", () => {
    renderWithI18n(<NodeStepCard step={makeStep()} />);
    expect(screen.getByTestId("gc-ri-card-node-1")).toBeDefined();
    expect(screen.getByText("node-1")).toBeDefined();
    expect(screen.getByText("task")).toBeDefined();
  });

  it("shows done status badge", () => {
    renderWithI18n(<NodeStepCard step={makeStep({ status: "done" })} />);
    const badge = screen.getByTestId("gc-ri-badge-node-1");
    expect(badge.textContent).toBe("Done");
    expect(badge.className).toContain("gc-ri-badge--done");
  });

  it("shows error status badge", () => {
    renderWithI18n(
      <NodeStepCard
        step={makeStep({
          status: "error",
          error: { message: "Something broke" },
        })}
      />,
    );
    const badge = screen.getByTestId("gc-ri-badge-node-1");
    expect(badge.textContent).toBe("Error");
    expect(badge.className).toContain("gc-ri-badge--error");
  });

  it("shows cached status badge", () => {
    renderWithI18n(<NodeStepCard step={makeStep({ status: "cached" })} />);
    const badge = screen.getByTestId("gc-ri-badge-node-1");
    expect(badge.textContent).toBe("Cached");
  });

  it("toggles inputs section when button clicked", () => {
    const step = makeStep({ inputs: { key: "value" } });
    renderWithI18n(<NodeStepCard step={step} />);

    expect(screen.queryByTestId("gc-ri-inputs-node-1")).toBeNull();
    const btn = screen.getByText("Inputs");
    fireEvent.click(btn);
    const pre = screen.getByTestId("gc-ri-inputs-node-1");
    expect(pre.textContent).toContain('"key": "value"');
  });

  it("toggles outputs section when button clicked", () => {
    const step = makeStep({ outputs: { result: 42 } });
    renderWithI18n(<NodeStepCard step={step} />);

    expect(screen.queryByTestId("gc-ri-outputs-node-1")).toBeNull();
    const btn = screen.getByText("Outputs");
    fireEvent.click(btn);
    const pre = screen.getByTestId("gc-ri-outputs-node-1");
    expect(pre.textContent).toContain('"result": 42');
  });

  it("calls onReplay with nodeId when Replay button is clicked", () => {
    const onReplay = vi.fn();
    renderWithI18n(<NodeStepCard step={makeStep()} onReplay={onReplay} />);

    const btn = screen.getByTestId("gc-ri-replay-node-1");
    fireEvent.click(btn);
    expect(onReplay).toHaveBeenCalledWith("node-1");
    expect(onReplay).toHaveBeenCalledTimes(1);
  });

  it("does not render Replay button when onReplay is not provided", () => {
    renderWithI18n(<NodeStepCard step={makeStep()} />);
    expect(screen.queryByTestId("gc-ri-replay-node-1")).toBeNull();
  });

  it("shows error message when step has error", () => {
    const step = makeStep({
      status: "error",
      error: { message: "Process failed with exit 1" },
    });
    renderWithI18n(<NodeStepCard step={step} />);
    const errBlock = screen.getByTestId("gc-ri-error-node-1");
    expect(errBlock.textContent).toContain("Process failed with exit 1");
  });

  it("shows LLM block when llm data is present", () => {
    const step = makeStep({
      llm: { provider: "openai", model: "gpt-4", tokens: 1500, costUsd: 0.045 },
    });
    renderWithI18n(<NodeStepCard step={step} />);
    const llmBlock = screen.getByTestId("gc-ri-llm-node-1");
    expect(llmBlock.textContent).toContain("openai");
    expect(llmBlock.textContent).toContain("gpt-4");
    expect(llmBlock.textContent).toContain("1500 tokens");
  });

  it("calls onNavigate when node id is clicked", () => {
    const onNavigate = vi.fn();
    renderWithI18n(<NodeStepCard step={makeStep()} onNavigate={onNavigate} />);
    const nodeIdEl = screen.getByText("node-1");
    fireEvent.click(nodeIdEl);
    expect(onNavigate).toHaveBeenCalledWith("node-1");
  });

  it("shows duration in ms", () => {
    const step = makeStep({ durationMs: 250 });
    renderWithI18n(<NodeStepCard step={step} />);
    expect(screen.getByText("250ms")).toBeDefined();
  });
});
