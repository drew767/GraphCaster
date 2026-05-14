// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import { WebhookInspectorFields } from "../WebhookInspectorFields";
import { buildWebhookUrl, _resetBrokerConfigCache } from "../brokerConfig";

const i18n = i18next.createInstance();
void i18n.use(initReactI18next).init({
  lng: "en",
  resources: {
    en: {
      translation: {
        "app.inspector.webhookPath": "Path",
        "app.inspector.webhookMethod": "Method",
        "app.inspector.webhookResponseMode": "Response mode",
        "app.inspector.webhookModeImmediately": "Immediately",
        "app.inspector.webhookModeAfterRun": "After run",
        "app.inspector.webhookModeCustom": "Custom",
        "app.inspector.webhookCustomStatus": "Status code",
        "app.inspector.webhookCustomBody": "Response body",
        "app.inspector.applyWebhookSettings": "Apply webhook fields",
        "app.inspector.webhookUrl": "Webhook URL",
        "app.inspector.webhookCopyUrl": "Copy URL",
        "app.inspector.webhookCopied": "Copied",
        "app.inspector.webhookTest": "Test webhook",
        "app.inspector.webhookTestHeaders": "Headers (JSON)",
        "app.inspector.webhookTestBody": "Body",
        "app.inspector.webhookTestSend": "Send",
        "app.inspector.webhookTestSending": "Sending…",
        "app.inspector.webhookTestStatus": "Status:",
      },
    },
  },
});

function wrap(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

beforeEach(() => {
  _resetBrokerConfigCache();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        publicUrl: "https://broker.example.com",
        version: "0.1.0",
        features: { scheduler: false, fsWatcher: false, poller: false, redisBus: false, collab: false },
      }),
    } as Response),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WebhookInspectorFields", () => {
  it("renders path, method, and response mode fields", () => {
    wrap(
      <WebhookInspectorFields
        nodeId="wh1"
        data={{ path: "/my-hook", method: "POST", responseMode: "after-run" }}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByTestId("gc-webhook-inspector-wh1")).toBeDefined();
    const pathInput = screen.getByDisplayValue("/my-hook");
    expect(pathInput).toBeDefined();
  });

  it("shows default values when data is empty", () => {
    wrap(
      <WebhookInspectorFields nodeId="wh2" data={{}} onApply={vi.fn()} />,
    );
    const pathInput = screen.getByDisplayValue("/my-graph");
    expect(pathInput).toBeDefined();
  });

  it("calls onApply with updated data on button click", () => {
    const onApply = vi.fn();
    wrap(
      <WebhookInspectorFields
        nodeId="wh3"
        data={{ path: "/hook" }}
        onApply={onApply}
      />,
    );
    const applyBtn = screen.getByText("Apply webhook fields");
    fireEvent.click(applyBtn);
    expect(onApply).toHaveBeenCalledOnce();
    const arg = onApply.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.path).toBe("/hook");
  });

  it("shows custom response fields when mode is custom", () => {
    wrap(
      <WebhookInspectorFields
        nodeId="wh4"
        data={{ path: "/hook", responseMode: "custom", customResponseStatus: 201, customResponseBody: '{"ok":true}' }}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("201")).toBeDefined();
    expect(screen.getByDisplayValue('{"ok":true}')).toBeDefined();
  });

  it("computes webhook URL using publicUrl from config", async () => {
    wrap(
      <WebhookInspectorFields nodeId="wh5" data={{ path: "/my-hook" }} onApply={vi.fn()} />,
    );
    await waitFor(() => {
      const urlInput = screen.getByTestId("gc-webhook-url-display");
      expect((urlInput as HTMLInputElement).value).toBe(
        "https://broker.example.com/webhook/my-hook",
      );
    });
  });

  it("falls back to window.location.origin when publicUrl is empty", async () => {
    _resetBrokerConfigCache();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          publicUrl: "",
          version: "",
          features: { scheduler: false, fsWatcher: false, poller: false, redisBus: false, collab: false },
        }),
      } as Response),
    );
    wrap(
      <WebhookInspectorFields nodeId="wh6" data={{ path: "/hook" }} onApply={vi.fn()} />,
    );
    await waitFor(() => {
      const urlInput = screen.getByTestId("gc-webhook-url-display");
      const val = (urlInput as HTMLInputElement).value;
      expect(val).toContain("/webhook/hook");
    });
  });

  it("toggles the test panel on button click", () => {
    wrap(
      <WebhookInspectorFields nodeId="wh7" data={{ path: "/hook" }} onApply={vi.fn()} />,
    );
    expect(screen.queryByTestId("gc-webhook-test-panel")).toBeNull();
    const toggleBtn = screen.getByTestId("gc-webhook-test-toggle");
    fireEvent.click(toggleBtn);
    expect(screen.getByTestId("gc-webhook-test-panel")).toBeDefined();
    fireEvent.click(toggleBtn);
    expect(screen.queryByTestId("gc-webhook-test-panel")).toBeNull();
  });

  it("shows send button inside test panel", () => {
    wrap(
      <WebhookInspectorFields nodeId="wh8" data={{ path: "/hook" }} onApply={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("gc-webhook-test-toggle"));
    expect(screen.getByTestId("gc-webhook-send")).toBeDefined();
  });

  it("sends test webhook and shows result", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          publicUrl: "https://broker.example.com",
          version: "0.1.0",
          features: { scheduler: false, fsWatcher: false, poller: false, redisBus: false, collab: false },
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{"started":true}',
      } as unknown as Response);

    vi.stubGlobal("fetch", mockFetch);
    _resetBrokerConfigCache();

    wrap(
      <WebhookInspectorFields nodeId="wh9" data={{ path: "/hook" }} onApply={vi.fn()} />,
    );

    fireEvent.click(screen.getByTestId("gc-webhook-test-toggle"));
    fireEvent.click(screen.getByTestId("gc-webhook-send"));

    await waitFor(() => {
      expect(screen.getByTestId("gc-webhook-test-result")).toBeDefined();
    });
    const result = screen.getByTestId("gc-webhook-test-result");
    expect(result.textContent).toContain("200");
    expect(result.textContent).toContain('{"started":true}');
  });
});

describe("buildWebhookUrl", () => {
  it("builds URL with publicUrl and path", () => {
    expect(buildWebhookUrl("https://host.example", "/my-hook")).toBe(
      "https://host.example/webhook/my-hook",
    );
  });

  it("normalizes path without leading slash", () => {
    expect(buildWebhookUrl("https://host.example", "my-hook")).toBe(
      "https://host.example/webhook/my-hook",
    );
  });

  it("returns origin-relative URL when publicUrl is empty", () => {
    const url = buildWebhookUrl("", "/hook");
    expect(url).toContain("/webhook/hook");
  });
});
