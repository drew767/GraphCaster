// Copyright GraphCaster. All Rights Reserved.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Accordion } from "./Accordion";
import type { AccordionItem } from "./Accordion";

const items: AccordionItem[] = [
  { id: "a", title: "Section A", content: <p>Content A</p> },
  { id: "b", title: "Section B", content: <p>Content B</p> },
  { id: "c", title: "Section C", content: <p>Content C</p> },
];

describe("Accordion", () => {
  it("renders all item titles", () => {
    render(<Accordion items={items} />);
    expect(screen.getByText("Section A")).toBeInTheDocument();
    expect(screen.getByText("Section B")).toBeInTheDocument();
    expect(screen.getByText("Section C")).toBeInTheDocument();
  });

  it("opens an item on click (single mode)", () => {
    render(<Accordion items={items} />);
    fireEvent.click(screen.getByText("Section A"));
    expect(screen.getByText("Content A")).toBeInTheDocument();
  });

  it("respects defaultValue in single mode", () => {
    render(<Accordion items={items} defaultValue="b" />);
    expect(screen.getByText("Content B")).toBeInTheDocument();
  });

  it("collapses previously open item when new one clicked (single mode)", () => {
    render(<Accordion items={items} />);
    fireEvent.click(screen.getByText("Section A"));
    fireEvent.click(screen.getByText("Section B"));
    expect(screen.queryByText("Content A")).not.toBeInTheDocument();
    expect(screen.getByText("Content B")).toBeInTheDocument();
  });

  it("allows multiple items open in multiple mode", () => {
    render(<Accordion items={items} type="multiple" />);
    fireEvent.click(screen.getByText("Section A"));
    fireEvent.click(screen.getByText("Section B"));
    expect(screen.getByText("Content A")).toBeInTheDocument();
    expect(screen.getByText("Content B")).toBeInTheDocument();
  });

  it("calls onValueChange when item toggled", () => {
    const onValueChange = vi.fn();
    render(
      <Accordion items={items} onValueChange={onValueChange} />,
    );
    fireEvent.click(screen.getByText("Section A"));
    expect(onValueChange).toHaveBeenCalledWith("a");
  });
});
