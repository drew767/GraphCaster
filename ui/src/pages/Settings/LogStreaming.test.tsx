// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import LogStreamingPage from "./LogStreaming";

describe("LogStreamingPage", () => {
  it("renders title and enterprise notice", () => {
    render(<LogStreamingPage />);
    expect(screen.getByTestId("log-streaming-page")).toBeTruthy();
    expect(screen.getByText("app.settings.logStreaming.title")).toBeTruthy();
    expect(screen.getByTestId("log-streaming-enterprise-notice")).toBeTruthy();
  });

  it("renders form with disabled fields and disabled actions", () => {
    render(<LogStreamingPage />);

    const form = screen.getByTestId("log-streaming-form") as HTMLFieldSetElement;
    expect(form.disabled).toBe(true);

    const urlInput = screen.getByTestId("log-streaming-url") as HTMLInputElement;
    expect(urlInput.disabled).toBe(true);

    const apiKeyInput = screen.getByTestId("log-streaming-api-key") as HTMLInputElement;
    expect(apiKeyInput.disabled).toBe(true);

    const testBtn = screen.getByTestId("log-streaming-test-btn") as HTMLButtonElement;
    expect(testBtn.disabled).toBe(true);

    const saveBtn = screen.getByTestId("log-streaming-save-btn") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it("renders Learn more link", () => {
    render(<LogStreamingPage />);
    const link = screen.getByTestId("log-streaming-learn-more") as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toContain("log-streaming");
  });
});
