// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { AppLayout } from "../AppLayout";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppLayout>
        <div data-testid="page-content">content</div>
      </AppLayout>
    </MemoryRouter>,
  );
}

describe("AppLayout — layout selection by path", () => {
  it("selects DefaultLayout for /home/workflows", () => {
    const { container } = renderAt("/home/workflows");
    expect(container.querySelector("[data-layout='default']")).not.toBeNull();
    expect(screen.getByTestId("page-content")).toBeTruthy();
  });

  it("selects WorkflowLayout for /workflow/123", () => {
    const { container } = renderAt("/workflow/123");
    expect(container.querySelector("[data-layout='workflow']")).not.toBeNull();
  });

  it("selects SettingsLayout for /settings/personal", () => {
    const { container } = renderAt("/settings/personal");
    expect(container.querySelector("[data-layout='settings']")).not.toBeNull();
  });

  it("selects AuthLayout for /signin", () => {
    const { container } = renderAt("/signin");
    expect(container.querySelector("[data-layout='auth']")).not.toBeNull();
  });

  it("selects AuthLayout for /signup", () => {
    const { container } = renderAt("/signup");
    expect(container.querySelector("[data-layout='auth']")).not.toBeNull();
  });

  it("selects AuthLayout for /forgot-password", () => {
    const { container } = renderAt("/forgot-password");
    expect(container.querySelector("[data-layout='auth']")).not.toBeNull();
  });

  it("selects AuthLayout for /setup", () => {
    const { container } = renderAt("/setup");
    expect(container.querySelector("[data-layout='auth']")).not.toBeNull();
  });

  it("selects DemoLayout for /demo", () => {
    const { container } = renderAt("/demo");
    expect(container.querySelector("[data-layout='demo']")).not.toBeNull();
  });

  it("selects DemoLayout for /embed/abc", () => {
    const { container } = renderAt("/embed/abc");
    expect(container.querySelector("[data-layout='demo']")).not.toBeNull();
  });
});

describe("AppLayout — slot presence", () => {
  it("DefaultLayout exposes sidebar, header, banners, and content slots", () => {
    const { container } = renderAt("/home");
    expect(container.querySelector("#gc-sidebar-slot")).not.toBeNull();
    expect(container.querySelector("#gc-header-slot")).not.toBeNull();
    expect(container.querySelector("#gc-banners-slot")).not.toBeNull();
    expect(container.querySelector(".gc-app-shell__content")).not.toBeNull();
  });

  it("WorkflowLayout exposes all default slots plus aside slot", () => {
    const { container } = renderAt("/workflow/42");
    expect(container.querySelector("#gc-sidebar-slot")).not.toBeNull();
    expect(container.querySelector("#gc-header-slot")).not.toBeNull();
    expect(container.querySelector("#gc-banners-slot")).not.toBeNull();
    expect(container.querySelector("#gc-aside-slot")).not.toBeNull();
  });

  it("SettingsLayout exposes sidebar, sub-sidebar, header, and content slots", () => {
    const { container } = renderAt("/settings");
    expect(container.querySelector("#gc-sidebar-slot")).not.toBeNull();
    expect(container.querySelector("#gc-settings-sub-sidebar-slot")).not.toBeNull();
    expect(container.querySelector("#gc-header-slot")).not.toBeNull();
    expect(container.querySelector(".gc-app-shell__content")).not.toBeNull();
  });

  it("AuthLayout has no sidebar slot", () => {
    const { container } = renderAt("/signin");
    expect(container.querySelector("#gc-sidebar-slot")).toBeNull();
    expect(container.querySelector(".gc-auth-shell__card")).not.toBeNull();
  });

  it("DemoLayout has no sidebar slot", () => {
    const { container } = renderAt("/demo");
    expect(container.querySelector("#gc-sidebar-slot")).toBeNull();
    expect(container.querySelector(".gc-demo-shell")).not.toBeNull();
  });
});

describe("AppLayout — WorkflowLayout aside default width", () => {
  it("aside slot carries width-0 class by default", () => {
    const { container } = renderAt("/workflow/7");
    const aside = container.querySelector("#gc-aside-slot") as HTMLElement | null;
    expect(aside).not.toBeNull();
    // CSS sets width:0 via .gc-app-shell__aside; verify the class is present
    expect(aside!.className).toContain("gc-app-shell__aside");
  });
});
