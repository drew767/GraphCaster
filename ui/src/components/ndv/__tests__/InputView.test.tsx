// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import React from "react";

import { InputView } from "../input/InputView";
import { useNdvStore } from "../useNdvStore";

beforeEach(() => {
  act(() => {
    useNdvStore.setState({
      activeNodeId: null,
      activeNodeType: null,
      panelWidths: {},
      inputView: {},
      outputView: {},
      itemIndex: {},
    });
  });
  localStorage.clear();
});

describe("InputView", () => {
  it("renders three tabs (Schema/Table/JSON)", () => {
    render(<InputView nodeId="n1" data={[{ a: 1 }]} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBe(3);
  });

  it("persists selected view per nodeId", () => {
    render(<InputView nodeId="n2" data={[{ a: 1 }]} />);
    const jsonTab = screen.getByRole("tab", { name: /json/i });
    fireEvent.mouseDown(jsonTab, { button: 0 });
    expect(useNdvStore.getState().inputView["n2"]).toBe("json");
  });
});
