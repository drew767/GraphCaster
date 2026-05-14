// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("../../components/ui/Icon/Icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

import {
  NodeStatusCornerIndicator,
  resolveNodeCornerStatus,
} from "./NodeStatusCornerIndicator";

describe("resolveNodeCornerStatus — priority order (error > running > pinned > muted > bypassed)", () => {
  it("returns null when nothing is active", () => {
    expect(
      resolveNodeCornerStatus({
        hasError: false,
        isRunning: false,
        isPinned: false,
        isMuted: false,
        isBypassed: false,
      }),
    ).toBeNull();
  });

  it("error wins over all others", () => {
    expect(
      resolveNodeCornerStatus({
        hasError: true,
        isRunning: true,
        isPinned: true,
        isMuted: true,
        isBypassed: true,
      }),
    ).toBe("error");
  });

  it("running wins over pinned, muted, bypassed", () => {
    expect(
      resolveNodeCornerStatus({
        hasError: false,
        isRunning: true,
        isPinned: true,
        isMuted: true,
        isBypassed: true,
      }),
    ).toBe("running");
  });

  it("pinned wins over muted and bypassed", () => {
    expect(
      resolveNodeCornerStatus({
        hasError: false,
        isRunning: false,
        isPinned: true,
        isMuted: true,
        isBypassed: true,
      }),
    ).toBe("pinned");
  });

  it("muted wins over bypassed", () => {
    expect(
      resolveNodeCornerStatus({
        hasError: false,
        isRunning: false,
        isPinned: false,
        isMuted: true,
        isBypassed: true,
      }),
    ).toBe("muted");
  });

  it("bypassed shows when nothing else is set", () => {
    expect(
      resolveNodeCornerStatus({
        hasError: false,
        isRunning: false,
        isPinned: false,
        isMuted: false,
        isBypassed: true,
      }),
    ).toBe("bypassed");
  });
});

describe("NodeStatusCornerIndicator — rendering", () => {
  it("returns nothing when status is null", () => {
    const { container } = render(<NodeStatusCornerIndicator status={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders error icon with circle-x", () => {
    const { container } = render(<NodeStatusCornerIndicator status="error" />);
    expect(container.querySelector("[data-status='error']")).not.toBeNull();
    expect(container.querySelector("[data-icon='circle-x']")).not.toBeNull();
  });

  it("renders running icon with loader", () => {
    const { container } = render(<NodeStatusCornerIndicator status="running" />);
    expect(container.querySelector("[data-status='running']")).not.toBeNull();
    expect(container.querySelector("[data-icon='loader']")).not.toBeNull();
  });

  it("renders pinned icon with pin", () => {
    const { container } = render(<NodeStatusCornerIndicator status="pinned" />);
    expect(container.querySelector("[data-icon='pin']")).not.toBeNull();
  });

  it("renders muted icon with volume-x", () => {
    const { container } = render(<NodeStatusCornerIndicator status="muted" />);
    expect(container.querySelector("[data-icon='volume-x']")).not.toBeNull();
  });

  it("renders bypassed icon with skip-forward", () => {
    const { container } = render(<NodeStatusCornerIndicator status="bypassed" />);
    expect(container.querySelector("[data-icon='skip-forward']")).not.toBeNull();
  });
});
