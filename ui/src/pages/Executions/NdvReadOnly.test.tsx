// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { NdvReadOnly } from "./NdvReadOnly";
import type { ExecutionNodePayload } from "./executionsApi";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const sampleNode: ExecutionNodePayload = {
  id: "n1",
  name: "Sample",
  status: "success",
  durationMs: 25,
  input: { a: 1 },
  parameters: { p: "v" },
  output: { ok: true },
};

describe("NdvReadOnly", () => {
  it("shows input, parameters, and output panels but no editable fields", () => {
    render(<NdvReadOnly node={sampleNode} open={true} onClose={() => {}} />);
    expect(screen.getByTestId("gc-exec-ndv")).toBeInTheDocument();
    expect(screen.getByTestId("gc-exec-ndv-input")).toHaveTextContent(/"a": 1/);
    expect(screen.getByTestId("gc-exec-ndv-parameters")).toHaveTextContent(/"p": "v"/);
    expect(screen.getByTestId("gc-exec-ndv-output")).toHaveTextContent(/"ok": true/);

    // No editable inputs/textareas/contenteditable
    const drawer = screen.getByTestId("gc-exec-ndv");
    expect(drawer.querySelectorAll("input").length).toBe(0);
    expect(drawer.querySelectorAll("textarea").length).toBe(0);
    expect(drawer.querySelectorAll("[contenteditable=\"true\"]").length).toBe(0);
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <NdvReadOnly node={sampleNode} open={false} onClose={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
