// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { Link } from "../Link";
import { ExternalLink } from "../ExternalLink";

describe("Link", () => {
  it("renders children as anchor", () => {
    render(<Link href="/test">Click me</Link>);
    expect(screen.getByText("Click me")).not.toBeNull();
    expect(screen.getByText("Click me").tagName).toBe("A");
  });

  it("applies default variant class", () => {
    const { container } = render(<Link>Default</Link>);
    expect(container.firstChild).toHaveClass("gc-link--default");
  });

  it("applies subtle variant class", () => {
    const { container } = render(<Link variant="subtle">subtle</Link>);
    expect(container.firstChild).toHaveClass("gc-link--subtle");
  });

  it("applies danger variant class", () => {
    const { container } = render(<Link variant="danger">danger</Link>);
    expect(container.firstChild).toHaveClass("gc-link--danger");
  });

  it("applies underline-always class", () => {
    const { container } = render(<Link underline="always">ul</Link>);
    expect(container.firstChild).toHaveClass("gc-link--underline-always");
  });

  it("applies underline-none class", () => {
    const { container } = render(<Link underline="none">none</Link>);
    expect(container.firstChild).toHaveClass("gc-link--underline-none");
  });

  it("passes through href and other anchor attrs", () => {
    render(<Link href="https://example.com">visit</Link>);
    const a = screen.getByText("visit") as HTMLAnchorElement;
    expect(a.getAttribute("href")).toBe("https://example.com");
  });
});

describe("ExternalLink", () => {
  it("sets target _blank", () => {
    render(<ExternalLink href="https://example.com">ext</ExternalLink>);
    const a = screen.getByText("ext").closest("a") as HTMLAnchorElement;
    expect(a.getAttribute("target")).toBe("_blank");
  });

  it("sets rel noopener noreferrer", () => {
    render(<ExternalLink href="https://example.com">ext</ExternalLink>);
    const a = screen.getByText("ext").closest("a") as HTMLAnchorElement;
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("renders external-link icon", () => {
    const { container } = render(
      <ExternalLink href="https://example.com">ext</ExternalLink>
    );
    expect(container.querySelector(".gc-link__external-icon")).not.toBeNull();
  });

  it("inherits Link variant prop", () => {
    const { container } = render(
      <ExternalLink variant="subtle" href="#">subtle ext</ExternalLink>
    );
    expect(container.firstChild).toHaveClass("gc-link--subtle");
  });

  it("renders children text", () => {
    render(<ExternalLink href="#">Docs</ExternalLink>);
    expect(screen.getByText("Docs")).not.toBeNull();
  });
});
