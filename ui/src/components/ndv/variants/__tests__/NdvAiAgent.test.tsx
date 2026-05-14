// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { NdvAiAgent, isAiAgentNodeType } from "../NdvAiAgent";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../../ui/Tabs/Tabs", () => ({
  Tabs: ({
    items,
    value,
    onValueChange,
  }: {
    items: Array<{ id: string; label: React.ReactNode; content: React.ReactNode }>;
    value: string;
    onValueChange: (id: string) => void;
  }) => (
    <div data-testid="tabs-mock">
      <div role="tablist">
        {items.map((it) => (
          <button
            key={it.id}
            role="tab"
            aria-selected={value === it.id}
            data-testid={`tab-${it.id}`}
            onClick={() => onValueChange(it.id)}
          >
            {it.label}
          </button>
        ))}
      </div>
      <div data-testid="tab-content">
        {items.find((it) => it.id === value)?.content}
      </div>
    </div>
  ),
}));

describe("isAiAgentNodeType", () => {
  it("matches agent and llm_agent types", () => {
    expect(isAiAgentNodeType("agent")).toBe(true);
    expect(isAiAgentNodeType("llm_agent")).toBe(true);
    expect(isAiAgentNodeType("task")).toBe(false);
  });
});

describe("NdvAiAgent", () => {
  it("renders the main body initially", () => {
    render(
      <NdvAiAgent
        nodeId="n1"
        body={<div data-testid="body-content">BODY</div>}
      />,
    );
    expect(screen.getByTestId("body-content")).toBeInTheDocument();
    expect(screen.getByTestId("tab-main")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("renders all four sub-tabs", () => {
    render(<NdvAiAgent nodeId="n1" body={<span />} />);
    expect(screen.getByTestId("tab-main")).toBeInTheDocument();
    expect(screen.getByTestId("tab-tool")).toBeInTheDocument();
    expect(screen.getByTestId("tab-memory")).toBeInTheDocument();
    expect(screen.getByTestId("tab-model")).toBeInTheDocument();
  });

  it("switches to a sub-connection tab and calls onTabChange", () => {
    const onTab = vi.fn();
    render(
      <NdvAiAgent
        nodeId="n1"
        body={<span data-testid="body" />}
        onTabChange={onTab}
      />,
    );

    fireEvent.click(screen.getByTestId("tab-tool"));
    expect(onTab).toHaveBeenCalledWith("tool");
    expect(screen.getByTestId("ai-agent-empty-ndv.aiAgent.empty.tool")).toBeInTheDocument();
  });

  it("renders provided sub-panels", () => {
    render(
      <NdvAiAgent
        nodeId="n1"
        body={<span />}
        toolPanel={<span data-testid="tool-panel">tool</span>}
        defaultTab="tool"
      />,
    );
    expect(screen.getByTestId("tool-panel")).toBeInTheDocument();
  });
});
