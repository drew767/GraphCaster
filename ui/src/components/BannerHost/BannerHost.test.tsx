// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import { BannerHost } from "./BannerHost";
import { useBannerStore } from "../../stores/bannerStore";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe("BannerHost", () => {
  beforeEach(() => {
    act(() => {
      useBannerStore.getState().clear();
    });
  });

  it("renders nothing when no banners", () => {
    const { container } = render(<BannerHost />);
    expect(container.querySelector(".gc-banner-host")).toBeNull();
  });

  it("renders pushed banners", () => {
    act(() => {
      useBannerStore.getState().push({ type: "info", message: "Hello" });
      useBannerStore.getState().push({ type: "error", message: "Boom" });
    });
    render(<BannerHost />);
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByText("Boom")).toBeInTheDocument();
  });

  it("dismiss removes the banner", () => {
    let id = "";
    act(() => {
      id = useBannerStore.getState().push({ type: "info", message: "Bye" });
    });
    render(<BannerHost />);
    expect(screen.getByText("Bye")).toBeInTheDocument();
    const dismissBtn = screen.getByLabelText("banners.dismiss");
    fireEvent.click(dismissBtn);
    expect(screen.queryByText("Bye")).toBeNull();
    expect(useBannerStore.getState().banners.find((b) => b.id === id)).toBeUndefined();
  });

  it("fires action callback", () => {
    const onClick = vi.fn();
    act(() => {
      useBannerStore
        .getState()
        .push({ type: "warning", message: "Heads up", action: { label: "Retry", onClick } });
    });
    render(<BannerHost />);
    fireEvent.click(screen.getByText("Retry"));
    expect(onClick).toHaveBeenCalled();
  });
});
