// Copyright GraphCaster. All Rights Reserved.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Skeleton, SkeletonCard, SkeletonRow, SkeletonTable } from "./Skeleton";

describe("Skeleton", () => {
  it("renders with default rect variant class", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toHaveClass("gc-skeleton--rect");
  });

  it("renders correct variant classes", () => {
    const { container: c1 } = render(<Skeleton variant="text" />);
    expect(c1.firstChild).toHaveClass("gc-skeleton--text");

    const { container: c2 } = render(<Skeleton variant="circle" />);
    expect(c2.firstChild).toHaveClass("gc-skeleton--circle");

    const { container: c3 } = render(<Skeleton variant="rounded" />);
    expect(c3.firstChild).toHaveClass("gc-skeleton--rounded");
  });

  it("applies custom width and height via inline style", () => {
    const { container } = render(<Skeleton width={200} height={40} />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.width).toBe("200px");
    expect(el.style.height).toBe("40px");
  });

  it("renders multiple elements when count > 1", () => {
    const { container } = render(<Skeleton count={4} />);
    expect(
      container.querySelectorAll(".gc-skeleton"),
    ).toHaveLength(4);
  });

  it("has shimmer animation class", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toHaveClass("gc-skeleton--shimmer");
  });

  it("SkeletonCard renders card structure", () => {
    render(<SkeletonCard />);
    expect(screen.getByLabelText("Loading card")).toBeInTheDocument();
  });

  it("SkeletonTable renders correct number of rows", () => {
    render(<SkeletonTable rows={3} columns={4} />);
    expect(screen.getAllByLabelText("Loading row")).toHaveLength(3);
  });
});
