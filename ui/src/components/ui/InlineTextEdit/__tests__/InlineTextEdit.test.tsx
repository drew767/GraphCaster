// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { InlineTextEdit } from "../InlineTextEdit";

describe("InlineTextEdit", () => {
  it("renders display mode initially", () => {
    render(
      <InlineTextEdit value="My Workflow" onChange={vi.fn()} />,
    );
    expect(screen.getByText("My Workflow")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("switches to edit mode on click", () => {
    render(<InlineTextEdit value="Name" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("typing updates internal draft state", () => {
    render(<InlineTextEdit value="Name" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "New Name" } });
    expect((input as HTMLInputElement).value).toBe("New Name");
  });

  it("Enter commits and calls onChange with new value", () => {
    const onChange = vi.fn();
    render(<InlineTextEdit value="Name" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Updated" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("Updated");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("Escape reverts and calls onCancel, display shows original", () => {
    const onCancel = vi.fn();
    const onChange = vi.fn();
    render(
      <InlineTextEdit value="Original" onChange={onChange} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole("button"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Changed" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("Original")).toBeInTheDocument();
  });

  it("blur with commitOn='blur' commits", () => {
    const onChange = vi.fn();
    render(
      <InlineTextEdit value="Foo" onChange={onChange} commitOn="blur" />,
    );
    fireEvent.click(screen.getByRole("button"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Bar" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("Bar");
  });

  it("blur with commitOn='enter' reverts without committing", () => {
    const onChange = vi.fn();
    const onCancel = vi.fn();
    render(
      <InlineTextEdit
        value="Foo"
        onChange={onChange}
        onCancel={onCancel}
        commitOn="enter"
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Bar" } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows aria-invalid when validate returns error", () => {
    const validate = (v: string) =>
      v.trim() === "" ? "Required" : undefined;
    render(
      <InlineTextEdit value="Name" onChange={vi.fn()} validate={validate} />,
    );
    fireEvent.click(screen.getByRole("button"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("textbox")).toHaveClass("gc-ite__input--error");
  });

  it("disabled prevents click-to-edit", () => {
    render(<InlineTextEdit value="Name" onChange={vi.fn()} disabled />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("maxLength prevents typing beyond limit", () => {
    render(
      <InlineTextEdit value="Hi" onChange={vi.fn()} maxLength={5} />,
    );
    fireEvent.click(screen.getByRole("button"));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.maxLength).toBe(5);
  });
});
