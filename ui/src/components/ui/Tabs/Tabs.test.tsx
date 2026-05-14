// Copyright GraphCaster. All Rights Reserved.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Tabs } from "./Tabs";
import type { TabItem } from "./Tabs";

const items: TabItem[] = [
  { id: "tab1", label: "Tab One", content: <p>Content 1</p> },
  { id: "tab2", label: "Tab Two", content: <p>Content 2</p> },
  { id: "tab3", label: "Tab Three", content: <p>Content 3</p>, disabled: true },
];

describe("Tabs", () => {
  it("renders all tab labels", () => {
    render(<Tabs items={items} />);
    expect(screen.getByText("Tab One")).toBeInTheDocument();
    expect(screen.getByText("Tab Two")).toBeInTheDocument();
    expect(screen.getByText("Tab Three")).toBeInTheDocument();
  });

  it("shows content of the default (first) tab", () => {
    render(<Tabs items={items} />);
    expect(screen.getByText("Content 1")).toBeInTheDocument();
  });

  it("switches active tab on click", () => {
    render(<Tabs items={items} defaultValue="tab1" />);
    const tab2 = screen.getByRole("tab", { name: "Tab Two" });
    fireEvent.mouseDown(tab2, { button: 0, ctrlKey: false });
    expect(tab2).toHaveAttribute("data-state", "active");
  });

  it("respects controlled value prop", () => {
    render(<Tabs items={items} value="tab2" onValueChange={vi.fn()} />);
    const trigger = screen.getByRole("tab", { name: "Tab Two" });
    expect(trigger).toHaveAttribute("data-state", "active");
  });

  it("calls onValueChange when tab clicked", () => {
    const onValueChange = vi.fn();
    render(<Tabs items={items} onValueChange={onValueChange} />);
    const tab2 = screen.getByRole("tab", { name: "Tab Two" });
    fireEvent.mouseDown(tab2, { button: 0, ctrlKey: false });
    expect(onValueChange).toHaveBeenCalledWith("tab2");
  });

  it("applies pills variant class", () => {
    const { container } = render(<Tabs items={items} variant="pills" />);
    expect(container.firstChild).toHaveClass("gc-tabs--pills");
  });

  it("applies vertical orientation class", () => {
    const { container } = render(<Tabs items={items} orientation="vertical" />);
    expect(container.firstChild).toHaveClass("gc-tabs--vertical");
  });

  it("renders icon when provided", () => {
    const withIcon: TabItem[] = [
      { id: "t1", label: "With Icon", icon: "check", content: <p>ic</p> },
    ];
    const { container } = render(<Tabs items={withIcon} />);
    expect(container.querySelector(".gc-tabs__trigger-icon")).toBeInTheDocument();
  });

  it("renders badge when provided", () => {
    const withBadge: TabItem[] = [
      { id: "t1", label: "Notif", badge: 5, content: <p>b</p> },
    ];
    const { container } = render(<Tabs items={withBadge} />);
    expect(container.querySelector(".gc-tabs__trigger-badge")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("disabled tab is not interactive", () => {
    render(<Tabs items={items} />);
    const disabledTab = screen.getByText("Tab Three").closest("[role='tab']");
    expect(disabledTab).toBeDisabled();
  });
});
