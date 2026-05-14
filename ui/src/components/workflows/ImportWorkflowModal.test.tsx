// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ImportWorkflowModal } from "./ImportWorkflowModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe("ImportWorkflowModal", () => {
  it("detects JSON when pasted", () => {
    render(<ImportWorkflowModal open onClose={() => {}} />);
    const ta = screen.getByTestId("gc-import-textarea") as HTMLTextAreaElement;
    fireEvent.change(ta, {
      target: { value: '{"nodes": [], "edges": []}' },
    });
    const detection = ta.closest(".gc-import-workflow-modal")?.querySelector(".gc-import-detection");
    expect(detection?.getAttribute("data-detected")).toBe("json");
  });

  it("detects cURL when pasted", () => {
    render(<ImportWorkflowModal open onClose={() => {}} />);
    const ta = screen.getByTestId("gc-import-textarea") as HTMLTextAreaElement;
    fireEvent.change(ta, {
      target: { value: "curl https://example.com/x" },
    });
    const detection = ta.closest(".gc-import-workflow-modal")?.querySelector(".gc-import-detection");
    expect(detection?.getAttribute("data-detected")).toBe("curl");
  });

  it("emits an HTTP request workflow from cURL", () => {
    const onImport = vi.fn();
    render(<ImportWorkflowModal open onClose={() => {}} onImport={onImport} />);
    const ta = screen.getByTestId("gc-import-textarea") as HTMLTextAreaElement;
    fireEvent.change(ta, {
      target: {
        value:
          "curl -X POST -H 'Content-Type: application/json' -d '{\"a\":1}' https://example.com/api",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "importWorkflow.submit" }));
    expect(onImport).toHaveBeenCalled();
    const result = onImport.mock.calls[0][0];
    expect(result.source).toBe("curl");
    const nodes = (result.workflow as { nodes: unknown[] }).nodes as Array<{
      type: string;
      data: { url: string; method: string };
    }>;
    expect(nodes.find((n) => n.type === "http_request")?.data.url).toBe(
      "https://example.com/api",
    );
    expect(nodes.find((n) => n.type === "http_request")?.data.method).toBe("POST");
  });
});
