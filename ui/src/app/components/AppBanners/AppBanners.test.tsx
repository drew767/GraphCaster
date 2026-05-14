// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { AppBanners } from "./AppBanners";
import type { Banner } from "../../stores/bannerStore";

function makeBanner(overrides: Partial<Banner> = {}): Banner {
  return {
    id: "b1",
    type: "info",
    message: "Test message",
    dismissible: true,
    ...overrides,
  };
}

describe("AppBanners", () => {
  let slot: HTMLDivElement;

  beforeEach(() => {
    slot = document.createElement("div");
    slot.id = "gc-banners-slot";
    document.body.appendChild(slot);
  });

  afterEach(() => {
    slot.remove();
  });

  it("renders banners into the slot", () => {
    render(
      <AppBanners banners={[makeBanner({ message: "Hello banner" })]} onDismiss={() => {}} />,
    );
    expect(screen.getByText("Hello banner")).not.toBeNull();
  });

  it("calls onDismiss with the banner id when close is clicked", () => {
    const onDismiss = vi.fn();
    render(
      <AppBanners banners={[makeBanner({ id: "x1" })]} onDismiss={onDismiss} />,
    );
    const closeBtn = screen.getByLabelText("Dismiss");
    fireEvent.click(closeBtn);
    expect(onDismiss).toHaveBeenCalledWith("x1");
  });

  it("renders type-specific CSS class for each banner type", () => {
    const types: Banner["type"][] = ["info", "warning", "error", "success"];
    const banners = types.map((type, i) =>
      makeBanner({ id: `b${i}`, type, message: `${type} msg` }),
    );
    render(<AppBanners banners={banners} onDismiss={() => {}} />);
    for (const type of types) {
      expect(document.querySelector(`.gc-banner--${type}`)).not.toBeNull();
    }
  });

  it("renders action button when action with onClick is provided", () => {
    const onClick = vi.fn();
    const banner = makeBanner({
      action: { label: "Retry", onClick },
    });
    render(<AppBanners banners={[banner]} onDismiss={() => {}} />);
    const actionBtn = screen.getByRole("button", { name: "Retry" });
    fireEvent.click(actionBtn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("returns null when no slot exists", () => {
    slot.remove();
    const { container } = render(
      <AppBanners banners={[makeBanner()]} onDismiss={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
