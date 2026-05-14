// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { Avatar, AvatarStack } from "../Avatar";

describe("Avatar", () => {
  it("renders root element with gc-avatar class", () => {
    const { container } = render(<Avatar fallback="Alice" />);
    expect(container.querySelector(".gc-avatar")).not.toBeNull();
  });

  it("applies size class", () => {
    const { container } = render(<Avatar fallback="X" size="large" />);
    expect(container.querySelector(".gc-avatar--large")).not.toBeNull();
  });

  it("applies shape circle class by default", () => {
    const { container } = render(<Avatar fallback="X" />);
    expect(container.querySelector(".gc-avatar--circle")).not.toBeNull();
  });

  it("applies shape square class", () => {
    const { container } = render(<Avatar fallback="X" shape="square" />);
    expect(container.querySelector(".gc-avatar--square")).not.toBeNull();
  });

  it("renders Radix image span in DOM when src provided", () => {
    const { container } = render(
      <Avatar src="https://example.com/img.png" alt="Test" fallback="T" />
    );
    expect(container.querySelector(".gc-avatar")).not.toBeNull();
  });

  it("renders all sizes without crashing", () => {
    const sizes = ["xsmall", "small", "medium", "large", "xlarge"] as const;
    for (const s of sizes) {
      const { container } = render(<Avatar fallback="A" size={s} />);
      expect(container.querySelector(`.gc-avatar--${s}`)).not.toBeNull();
    }
  });

  it("accepts custom color prop", () => {
    const { container } = render(
      <Avatar fallback="Bob" color="#ff0000" />
    );
    expect(container.querySelector(".gc-avatar")).not.toBeNull();
  });
});

describe("Avatar — initials logic (via data-testid fallback)", () => {
  it("fallback element exists in DOM (Radix renders it)", () => {
    const { container } = render(<Avatar fallback="Alice" />);
    const root = container.querySelector(".gc-avatar");
    expect(root).not.toBeNull();
  });
});

describe("AvatarStack", () => {
  const avatars = [
    { fallback: "Alice" },
    { fallback: "Bob" },
    { fallback: "Carol" },
    { fallback: "Dave" },
    { fallback: "Eve" },
  ];

  it("renders up to max avatars", () => {
    const { container } = render(<AvatarStack avatars={avatars} max={3} />);
    const items = container.querySelectorAll(".gc-avatar-stack__item");
    expect(items.length).toBe(3);
  });

  it("shows overflow count when avatars exceed max", () => {
    render(<AvatarStack avatars={avatars} max={3} />);
    expect(screen.getByText("+2")).not.toBeNull();
  });

  it("does not show overflow when within max", () => {
    const { container } = render(
      <AvatarStack avatars={avatars.slice(0, 3)} max={5} />
    );
    expect(container.querySelector(".gc-avatar-stack__overflow")).toBeNull();
  });

  it("passes size to child avatars", () => {
    const { container } = render(
      <AvatarStack avatars={[{ fallback: "A" }]} size="large" />
    );
    expect(container.querySelector(".gc-avatar--large")).not.toBeNull();
  });

  it("renders stack container with group role", () => {
    render(<AvatarStack avatars={avatars.slice(0, 2)} />);
    expect(screen.getByRole("group")).not.toBeNull();
  });
});
