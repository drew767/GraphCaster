// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { Pagination } from "../Pagination";

describe("Pagination", () => {
  it("renders all navigation buttons and page numbers", () => {
    render(
      <Pagination currentPage={1} totalPages={5} onPageChange={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /first page/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /last page/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /previous page/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next page/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /page 1/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /page 5/i })).toBeInTheDocument();
  });

  it("highlights the current page with aria-current", () => {
    render(
      <Pagination currentPage={3} totalPages={5} onPageChange={vi.fn()} />,
    );
    const activeBtn = screen.getByRole("button", { name: /page 3/i });
    expect(activeBtn).toHaveAttribute("aria-current", "page");
    const otherBtn = screen.getByRole("button", { name: /page 1/i });
    expect(otherBtn).not.toHaveAttribute("aria-current");
  });

  it("calls onPageChange with the correct page when a page button is clicked", () => {
    const onPageChange = vi.fn();
    render(
      <Pagination currentPage={2} totalPages={5} onPageChange={onPageChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /page 3/i }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("disables Prev and First buttons on first page", () => {
    render(
      <Pagination currentPage={1} totalPages={5} onPageChange={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /first page/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /previous page/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /next page/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /last page/i })).not.toBeDisabled();
  });

  it("disables Next and Last buttons on last page", () => {
    render(
      <Pagination currentPage={5} totalPages={5} onPageChange={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /last page/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /next page/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /first page/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /previous page/i })).not.toBeDisabled();
  });

  it("hides First and Last buttons when showFirstLast=false", () => {
    render(
      <Pagination
        currentPage={3}
        totalPages={5}
        onPageChange={vi.fn()}
        showFirstLast={false}
      />,
    );
    expect(screen.queryByRole("button", { name: /first page/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /last page/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /previous page/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next page/i })).toBeInTheDocument();
  });

  it("shows ellipsis for many pages when current is in the middle", () => {
    const { container } = render(
      <Pagination
        currentPage={10}
        totalPages={20}
        onPageChange={vi.fn()}
        siblingCount={1}
      />,
    );
    const ellipses = container.querySelectorAll(".gc-pagination__ellipsis");
    expect(ellipses.length).toBe(2);
    expect(screen.getByRole("button", { name: "Page 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Page 20" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Page 10" })).toBeInTheDocument();
  });
});
