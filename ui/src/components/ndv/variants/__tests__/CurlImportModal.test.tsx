// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import {
  CurlImportModal,
  curlResultToPatch,
  isHttpRequestNodeType,
} from "../CurlImportModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../../ui/Dialog/Dialog", () => ({
  Dialog: ({
    open,
    children,
    footer,
    title,
  }: {
    open?: boolean;
    children: React.ReactNode;
    footer?: React.ReactNode;
    title?: React.ReactNode;
  }) =>
    open ? (
      <div role="dialog" aria-label={typeof title === "string" ? title : undefined}>
        <div>{children}</div>
        <div>{footer}</div>
      </div>
    ) : null,
}));

vi.mock("../../../ui/Button/Button", () => ({
  Button: ({
    children,
    onClick,
    "data-testid": testId,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    "data-testid"?: string;
  }) => (
    <button data-testid={testId} onClick={onClick}>
      {children}
    </button>
  ),
}));

describe("isHttpRequestNodeType", () => {
  it("matches http_request", () => {
    expect(isHttpRequestNodeType("http_request")).toBe(true);
    expect(isHttpRequestNodeType("task")).toBe(false);
  });
});

describe("curlResultToPatch", () => {
  it("copies fields and clones headers", () => {
    const patch = curlResultToPatch({
      url: "https://x.test",
      method: "POST",
      headers: { A: "1" },
      body: "x=1",
    });
    expect(patch).toEqual({
      url: "https://x.test",
      method: "POST",
      headers: { A: "1" },
      body: "x=1",
    });
  });
});

describe("CurlImportModal", () => {
  it("imports a valid cURL command and calls onApplyNodeData", () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(
      <CurlImportModal
        open
        onClose={onClose}
        onApplyNodeData={onApply}
      />,
    );

    fireEvent.change(screen.getByTestId("curl-import-textarea"), {
      target: {
        value:
          "curl -X POST https://api.example/v1/items -H 'Content-Type: application/json' -d '{\"k\":1}'",
      },
    });
    fireEvent.click(screen.getByTestId("curl-import-submit"));

    expect(onApply).toHaveBeenCalledTimes(1);
    const arg = onApply.mock.calls[0][0];
    expect(arg.parameters.url).toBe("https://api.example/v1/items");
    expect(arg.parameters.method).toBe("POST");
    expect(arg.parameters.headers["Content-Type"]).toBe("application/json");
    expect(arg.parameters.body).toBe('{"k":1}');
    expect(onClose).toHaveBeenCalled();
  });

  it("shows error on empty input", () => {
    render(
      <CurlImportModal
        open
        onClose={() => {}}
        onApplyNodeData={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("curl-import-submit"));
    expect(screen.getByTestId("curl-import-error")).toBeInTheDocument();
  });

  it("shows parser error for non-curl input", () => {
    render(
      <CurlImportModal
        open
        onClose={() => {}}
        onApplyNodeData={() => {}}
      />,
    );
    fireEvent.change(screen.getByTestId("curl-import-textarea"), {
      target: { value: "not curl" },
    });
    fireEvent.click(screen.getByTestId("curl-import-submit"));
    expect(screen.getByTestId("curl-import-error")).toBeInTheDocument();
  });
});
