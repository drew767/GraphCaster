// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../ui/Icon/Icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}));

import { CanvasNodeChoicePrompt } from "../CanvasNodeChoicePrompt";

describe("CanvasNodeChoicePrompt", () => {
  const onAddNode = vi.fn();
  const onBuildWithAI = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders both cards when open=true", () => {
    render(
      <CanvasNodeChoicePrompt
        open={true}
        onAddNode={onAddNode}
        onBuildWithAI={onBuildWithAI}
      />,
    );
    expect(screen.getByTestId("choice-prompt-add-node-btn")).toBeInTheDocument();
    expect(screen.getByTestId("choice-prompt-build-ai-btn")).toBeInTheDocument();
  });

  it("does not render when open=false", () => {
    render(
      <CanvasNodeChoicePrompt
        open={false}
        onAddNode={onAddNode}
        onBuildWithAI={onBuildWithAI}
      />,
    );
    expect(screen.queryByTestId("canvas-choice-prompt")).not.toBeInTheDocument();
  });

  it("clicking Add Node button fires onAddNode", () => {
    render(
      <CanvasNodeChoicePrompt
        open={true}
        onAddNode={onAddNode}
        onBuildWithAI={onBuildWithAI}
      />,
    );
    fireEvent.click(screen.getByTestId("choice-prompt-add-node-btn"));
    expect(onAddNode).toHaveBeenCalledTimes(1);
    expect(onBuildWithAI).not.toHaveBeenCalled();
  });

  it("clicking Build with AI button fires onBuildWithAI", () => {
    render(
      <CanvasNodeChoicePrompt
        open={true}
        onAddNode={onAddNode}
        onBuildWithAI={onBuildWithAI}
      />,
    );
    fireEvent.click(screen.getByTestId("choice-prompt-build-ai-btn"));
    expect(onBuildWithAI).toHaveBeenCalledTimes(1);
    expect(onAddNode).not.toHaveBeenCalled();
  });
});
