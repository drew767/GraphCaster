// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GraphCard } from "../GraphCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("GraphCard", () => {
  it("renders title and fileName", () => {
    render(
      <GraphCard
        graphId="test-graph-id"
        title="My Workflow"
        fileName="my-workflow.json"
      />,
    );
    expect(screen.getByText("My Workflow")).toBeInTheDocument();
    expect(screen.getByText("my-workflow.json")).toBeInTheDocument();
  });

  it("renders <img> when thumbnailUrl is provided", () => {
    render(
      <GraphCard
        graphId="test-id"
        title="Graph with thumb"
        fileName="graph.json"
        thumbnailUrl="http://localhost:9847/api/v1/graphs/test-id/thumbnail"
      />,
    );
    const img = screen.getByRole("img");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute(
      "src",
      "http://localhost:9847/api/v1/graphs/test-id/thumbnail",
    );
  });

  it("renders placeholder (no <img>) when thumbnailUrl is null", () => {
    render(
      <GraphCard
        graphId="test-id"
        title="Graph without thumb"
        fileName="graph.json"
        thumbnailUrl={null}
      />,
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders placeholder (no <img>) when thumbnailUrl is omitted", () => {
    render(
      <GraphCard
        graphId="test-id"
        title="No thumb"
        fileName="graph.json"
      />,
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows fileName as title text when title is empty string", () => {
    render(
      <GraphCard
        graphId="test-id"
        title=""
        fileName="fallback.json"
      />,
    );
    const titles = screen.getAllByText("fallback.json");
    expect(titles.length).toBeGreaterThan(0);
  });

  it("applies gc-graph-card--selected class when selected=true", () => {
    const { container } = render(
      <GraphCard
        graphId="test-id"
        title="Selected"
        fileName="sel.json"
        selected
      />,
    );
    expect(container.querySelector(".gc-graph-card--selected")).not.toBeNull();
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(
      <GraphCard
        graphId="test-id"
        title="Clickable"
        fileName="click.json"
        onClick={onClick}
      />,
    );
    screen.getByRole("button").click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
