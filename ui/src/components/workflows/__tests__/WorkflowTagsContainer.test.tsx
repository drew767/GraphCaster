// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll } from "vitest";

import { WorkflowTagsContainer } from "../WorkflowTagsContainer";

// Radix Popover uses ResizeObserver
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

// i18n setup: vitest.setup.ts doesn't init i18next so we use a simple mock.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === "app.workflows.tags.createTag" && opts?.name)
        return `+ Create '${opts.name}'`;
      return key;
    },
  }),
}));

describe("WorkflowTagsContainer", () => {
  it("renders existing tags as chips", () => {
    render(
      <WorkflowTagsContainer
        tags={["alpha", "beta"]}
        onChange={vi.fn()}
        availableTags={[]}
      />
    );
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
  });

  it("renders close buttons on tags when not readOnly", () => {
    render(
      <WorkflowTagsContainer
        tags={["alpha"]}
        onChange={vi.fn()}
        availableTags={[]}
      />
    );
    expect(screen.getAllByRole("button", { name: /remove/i })).toHaveLength(1);
  });

  it("calls onChange without the removed tag when × is clicked", () => {
    const onChange = vi.fn();
    render(
      <WorkflowTagsContainer
        tags={["alpha", "beta"]}
        onChange={onChange}
        availableTags={[]}
      />
    );
    const closeButtons = screen.getAllByRole("button", { name: /remove/i });
    fireEvent.click(closeButtons[0]);
    expect(onChange).toHaveBeenCalledWith(["beta"]);
  });

  it("opens popover with autocomplete suggestions when Add tag button clicked", () => {
    render(
      <WorkflowTagsContainer
        tags={[]}
        onChange={vi.fn()}
        availableTags={["foo", "bar"]}
      />
    );
    const addBtn = screen.getByRole("button", { name: /app.workflows.tags.addTag/i });
    fireEvent.click(addBtn);
    expect(screen.getByText("foo")).toBeInTheDocument();
    expect(screen.getByText("bar")).toBeInTheDocument();
  });

  it("adds a tag from suggestions and calls onChange", () => {
    const onChange = vi.fn();
    render(
      <WorkflowTagsContainer
        tags={[]}
        onChange={onChange}
        availableTags={["foo", "bar"]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /app.workflows.tags.addTag/i }));
    fireEvent.click(screen.getByText("foo"));
    expect(onChange).toHaveBeenCalledWith(["foo"]);
  });

  it("shows create item when query does not match any tag", async () => {
    render(
      <WorkflowTagsContainer
        tags={[]}
        onChange={vi.fn()}
        availableTags={["foo"]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /app.workflows.tags.addTag/i }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "newTag" } });
    await waitFor(() =>
      expect(screen.getByText(/\+ Create 'newTag'/i)).toBeInTheDocument()
    );
  });

  it("calls onCreateTag and onChange when create item is clicked", async () => {
    const onCreateTag = vi.fn().mockResolvedValue(undefined);
    const onChange = vi.fn();
    render(
      <WorkflowTagsContainer
        tags={[]}
        onChange={onChange}
        availableTags={[]}
        onCreateTag={onCreateTag}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /app.workflows.tags.addTag/i }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "myNewTag" } });
    await waitFor(() =>
      expect(screen.getByText(/\+ Create 'myNewTag'/i)).toBeInTheDocument()
    );
    await act(async () => {
      fireEvent.click(screen.getByText(/\+ Create 'myNewTag'/i));
    });
    expect(onCreateTag).toHaveBeenCalledWith("myNewTag");
    expect(onChange).toHaveBeenCalledWith(["myNewTag"]);
  });
});
