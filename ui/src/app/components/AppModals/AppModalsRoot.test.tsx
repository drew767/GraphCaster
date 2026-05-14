// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, act } from "@testing-library/react";
import { describe, expect, it, afterEach } from "vitest";

import { AppModalsRoot } from "./AppModalsRoot";

describe("AppModalsRoot", () => {
  afterEach(() => {
    document.getElementById("gc-app-modals")?.remove();
  });

  it("mounts a #gc-app-modals div in document.body", () => {
    render(<AppModalsRoot />);
    expect(document.getElementById("gc-app-modals")).not.toBeNull();
  });

  it("removes the #gc-app-modals div on unmount", () => {
    const { unmount } = render(<AppModalsRoot />);
    expect(document.getElementById("gc-app-modals")).not.toBeNull();
    act(() => {
      unmount();
    });
    expect(document.getElementById("gc-app-modals")).toBeNull();
  });

  it("does not create a duplicate element if one already exists", () => {
    const existing = document.createElement("div");
    existing.id = "gc-app-modals";
    document.body.appendChild(existing);

    render(<AppModalsRoot />);

    const all = document.querySelectorAll("#gc-app-modals");
    expect(all.length).toBe(1);
  });
});
