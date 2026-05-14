// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { NdvVersionSelector } from "../NdvVersionSelector";
import {
  registerNodeVersions,
  clearNodeVersions,
  getLatestVersion,
  hasUpgrade,
} from "../../../graph/nodeRegistry";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../ui/Select/Select", () => ({
  Select: <T extends string>(props: {
    value: T;
    onValueChange?: (v: T) => void;
    options: Array<{ value: T; label: string }>;
    "data-testid"?: string;
  }) => (
    <select
      data-testid={props["data-testid"] ?? "select"}
      value={props.value}
      onChange={(e) => props.onValueChange?.(e.target.value as T)}
    >
      {props.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock("../../ui/Badge/Badge", () => ({
  Badge: ({ text }: { text?: string }) => <span>{text}</span>,
}));

describe("nodeRegistry helpers", () => {
  beforeEach(() => {
    clearNodeVersions("test_node");
  });

  it("returns latest version respecting latest flag", () => {
    registerNodeVersions("test_node", [
      { version: 1, latest: true },
      { version: 2 },
    ]);
    expect(getLatestVersion("test_node")).toBe(1);
  });

  it("falls back to highest when no latest flag", () => {
    registerNodeVersions("test_node", [{ version: 1 }, { version: 3 }]);
    expect(getLatestVersion("test_node")).toBe(3);
  });

  it("hasUpgrade reflects current vs latest", () => {
    registerNodeVersions("test_node", [
      { version: 1 },
      { version: 2, latest: true },
    ]);
    expect(hasUpgrade("test_node", 1)).toBe(true);
    expect(hasUpgrade("test_node", 2)).toBe(false);
  });
});

describe("NdvVersionSelector", () => {
  beforeEach(() => {
    clearNodeVersions("multi_node");
    clearNodeVersions("single_node");
  });

  it("renders nothing when only one version exists", () => {
    registerNodeVersions("single_node", [{ version: 1 }]);
    const { container } = render(
      <NdvVersionSelector
        nodeType="single_node"
        currentVersion={1}
        onChange={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows selector and upgrade badge when newer version exists", () => {
    registerNodeVersions("multi_node", [
      { version: 1 },
      { version: 2, latest: true },
    ]);
    const onChange = vi.fn();
    render(
      <NdvVersionSelector
        nodeType="multi_node"
        currentVersion={1}
        onChange={onChange}
      />,
    );
    expect(screen.getByTestId("ndv-version-selector")).toBeInTheDocument();
    expect(screen.getByTestId("ndv-version-upgrade-badge")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("ndv-version-select"), {
      target: { value: "2" },
    });
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("does not call onChange when same version selected", () => {
    registerNodeVersions("multi_node", [
      { version: 1 },
      { version: 2, latest: true },
    ]);
    const onChange = vi.fn();
    render(
      <NdvVersionSelector
        nodeType="multi_node"
        currentVersion={2}
        onChange={onChange}
      />,
    );
    expect(screen.queryByTestId("ndv-version-upgrade-badge")).toBeNull();
    fireEvent.change(screen.getByTestId("ndv-version-select"), {
      target: { value: "2" },
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});
