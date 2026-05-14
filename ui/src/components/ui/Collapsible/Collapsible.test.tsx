// Copyright GraphCaster. All Rights Reserved.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Collapsible } from "./Collapsible";

describe("Collapsible", () => {
  it("renders trigger and hides content by default", () => {
    render(
      <Collapsible trigger="Show more">
        <p>Hidden content</p>
      </Collapsible>,
    );
    expect(screen.getByText("Show more")).toBeInTheDocument();
    expect(screen.queryByText("Hidden content")).not.toBeInTheDocument();
  });

  it("opens content when trigger is clicked", () => {
    render(
      <Collapsible trigger="Toggle" defaultOpen={false}>
        <p>Revealed</p>
      </Collapsible>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Revealed")).toBeInTheDocument();
  });

  it("respects controlled open prop", () => {
    render(
      <Collapsible trigger="Open" open={true}>
        <p>Visible content</p>
      </Collapsible>,
    );
    expect(screen.getByText("Visible content")).toBeInTheDocument();
  });

  it("calls onOpenChange when triggered", () => {
    const onOpenChange = vi.fn();
    render(
      <Collapsible trigger="Click me" onOpenChange={onOpenChange}>
        <p>content</p>
      </Collapsible>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("renders chevron on trailing side when triggerSide=trailing", () => {
    const { container } = render(
      <Collapsible trigger="label" triggerSide="trailing">
        content
      </Collapsible>,
    );
    const trigger = container.querySelector(".gc-collapsible__trigger--trailing");
    expect(trigger).toBeInTheDocument();
  });
});
