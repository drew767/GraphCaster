// Copyright GraphCaster. All Rights Reserved.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { buildWebhookUrl, fetchBrokerConfig } from "./brokerConfig";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";
type ResponseMode = "immediately" | "after-run" | "custom";

export interface WebhookNodeData {
  path?: string;
  method?: HttpMethod;
  responseMode?: ResponseMode;
  customResponseStatus?: number;
  customResponseBody?: string;
}

interface Props {
  nodeId: string;
  data: Record<string, unknown>;
  runLocked?: boolean;
  onApply: (data: Record<string, unknown>) => void;
}

interface TestResult {
  status: number;
  body: string;
  durationMs: number;
}

export function WebhookInspectorFields({ nodeId, data, runLocked, onApply }: Props) {
  const { t } = useTranslation();

  const rawPath = typeof data.path === "string" ? data.path : "/my-graph";
  const rawMethod =
    data.method === "GET" || data.method === "PUT" || data.method === "DELETE"
      ? (data.method as HttpMethod)
      : "POST";
  const rawMode =
    data.responseMode === "immediately" || data.responseMode === "custom"
      ? (data.responseMode as ResponseMode)
      : "after-run";
  const rawStatus = typeof data.customResponseStatus === "number" ? data.customResponseStatus : 200;
  const rawBody = typeof data.customResponseBody === "string" ? data.customResponseBody : "";

  const [path, setPath] = useState(rawPath);
  const [method, setMethod] = useState<HttpMethod>(rawMethod);
  const [responseMode, setResponseMode] = useState<ResponseMode>(rawMode);
  const [customStatus, setCustomStatus] = useState(String(rawStatus));
  const [customBody, setCustomBody] = useState(rawBody);

  const [webhookUrl, setWebhookUrl] = useState("");
  const [copied, setCopied] = useState(false);

  const [testOpen, setTestOpen] = useState(false);
  const [testHeaders, setTestHeaders] = useState('{"Content-Type": "application/json"}');
  const [testBody, setTestBody] = useState('{}');
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void fetchBrokerConfig().then((cfg) => {
      setWebhookUrl(buildWebhookUrl(cfg.publicUrl, path));
    });
  }, [path]);

  const handleApply = useCallback(() => {
    const statusNum = parseInt(customStatus, 10);
    const patch: Record<string, unknown> = {
      ...data,
      path,
      method,
      responseMode,
    };
    if (responseMode === "custom") {
      patch.customResponseStatus = isNaN(statusNum) ? 200 : statusNum;
      patch.customResponseBody = customBody;
    }
    onApply(patch);
  }, [data, path, method, responseMode, customStatus, customBody, onApply]);

  const handleCopyUrl = useCallback(() => {
    if (!navigator.clipboard) return;
    void navigator.clipboard.writeText(webhookUrl).then(() => {
      setCopied(true);
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1500);
    });
  }, [webhookUrl]);

  const handleSendTest = useCallback(async () => {
    setTestSending(true);
    setTestResult(null);
    setTestError(null);
    const start = Date.now();
    try {
      let parsedHeaders: Record<string, string> = {};
      try {
        parsedHeaders = JSON.parse(testHeaders) as Record<string, string>;
      } catch {
        parsedHeaders = {};
      }
      const hasBody = method !== "GET" && method !== "DELETE";
      const res = await fetch(webhookUrl, {
        method,
        headers: parsedHeaders,
        ...(hasBody ? { body: testBody } : {}),
      });
      const bodyText = await res.text();
      setTestResult({ status: res.status, body: bodyText, durationMs: Date.now() - start });
    } catch (err) {
      setTestError(err instanceof Error ? err.message : String(err));
    } finally {
      setTestSending(false);
    }
  }, [webhookUrl, method, testHeaders, testBody]);

  return (
    <div className="gc-inspector-webhook" data-testid={`gc-webhook-inspector-${nodeId}`}>
      <div className="gc-inspector-row gc-inspector-row--field">
        <label className="gc-inspector-data-label" htmlFor={`gc-wh-path-${nodeId}`}>
          {t("app.inspector.webhookPath")}
        </label>
        <input
          id={`gc-wh-path-${nodeId}`}
          className="gc-inspector-condition-input"
          type="text"
          disabled={runLocked}
          spellCheck={false}
          autoComplete="off"
          value={path}
          onChange={(ev) => setPath(ev.target.value)}
        />
      </div>

      <div className="gc-inspector-row gc-inspector-row--field">
        <label className="gc-inspector-data-label" htmlFor={`gc-wh-method-${nodeId}`}>
          {t("app.inspector.webhookMethod")}
        </label>
        <select
          id={`gc-wh-method-${nodeId}`}
          className="gc-inspector-select"
          disabled={runLocked}
          value={method}
          onChange={(ev) => setMethod(ev.target.value as HttpMethod)}
        >
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="DELETE">DELETE</option>
        </select>
      </div>

      <div className="gc-inspector-row gc-inspector-row--field">
        <label className="gc-inspector-data-label" htmlFor={`gc-wh-mode-${nodeId}`}>
          {t("app.inspector.webhookResponseMode")}
        </label>
        <select
          id={`gc-wh-mode-${nodeId}`}
          className="gc-inspector-select"
          disabled={runLocked}
          value={responseMode}
          onChange={(ev) => setResponseMode(ev.target.value as ResponseMode)}
        >
          <option value="immediately">{t("app.inspector.webhookModeImmediately")}</option>
          <option value="after-run">{t("app.inspector.webhookModeAfterRun")}</option>
          <option value="custom">{t("app.inspector.webhookModeCustom")}</option>
        </select>
      </div>

      {responseMode === "custom" && (
        <>
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-data-label" htmlFor={`gc-wh-status-${nodeId}`}>
              {t("app.inspector.webhookCustomStatus")}
            </label>
            <input
              id={`gc-wh-status-${nodeId}`}
              className="gc-inspector-condition-input"
              type="number"
              min={100}
              max={599}
              disabled={runLocked}
              value={customStatus}
              onChange={(ev) => setCustomStatus(ev.target.value)}
            />
          </div>
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-data-label" htmlFor={`gc-wh-body-${nodeId}`}>
              {t("app.inspector.webhookCustomBody")}
            </label>
            <textarea
              id={`gc-wh-body-${nodeId}`}
              className="gc-inspector-data-textarea"
              rows={3}
              disabled={runLocked}
              spellCheck={false}
              autoComplete="off"
              value={customBody}
              onChange={(ev) => setCustomBody(ev.target.value)}
            />
          </div>
        </>
      )}

      <button
        type="button"
        className="gc-btn gc-inspector-apply"
        disabled={runLocked}
        onClick={handleApply}
      >
        {t("app.inspector.applyWebhookSettings")}
      </button>

      <div className="gc-inspector-row gc-inspector-row--field" style={{ marginTop: "8px" }}>
        <label className="gc-inspector-data-label">{t("app.inspector.webhookUrl")}</label>
        <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
          <input
            className="gc-inspector-condition-input"
            type="text"
            readOnly
            value={webhookUrl}
            aria-label={t("app.inspector.webhookUrl")}
            style={{ flex: 1 }}
            data-testid="gc-webhook-url-display"
          />
          <button
            type="button"
            className="gc-btn gc-inspector-apply"
            onClick={handleCopyUrl}
            title={t("app.inspector.webhookCopyUrl")}
            data-testid="gc-webhook-copy-url"
          >
            {copied ? t("app.inspector.webhookCopied") : t("app.inspector.webhookCopyUrl")}
          </button>
        </div>
      </div>

      <div className="gc-inspector-row gc-inspector-row--field">
        <button
          type="button"
          className="gc-btn"
          onClick={() => setTestOpen((v) => !v)}
          aria-expanded={testOpen}
          data-testid="gc-webhook-test-toggle"
        >
          {t("app.inspector.webhookTest")}
        </button>
      </div>

      {testOpen && (
        <div className="gc-webhook-test-panel" data-testid="gc-webhook-test-panel">
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-data-label" htmlFor={`gc-wh-test-headers-${nodeId}`}>
              {t("app.inspector.webhookTestHeaders")}
            </label>
            <textarea
              id={`gc-wh-test-headers-${nodeId}`}
              className="gc-inspector-data-textarea"
              rows={3}
              spellCheck={false}
              autoComplete="off"
              value={testHeaders}
              onChange={(ev) => setTestHeaders(ev.target.value)}
            />
          </div>
          {method !== "GET" && method !== "DELETE" && (
            <div className="gc-inspector-row gc-inspector-row--field">
              <label className="gc-inspector-data-label" htmlFor={`gc-wh-test-body-${nodeId}`}>
                {t("app.inspector.webhookTestBody")}
              </label>
              <textarea
                id={`gc-wh-test-body-${nodeId}`}
                className="gc-inspector-data-textarea"
                rows={4}
                spellCheck={false}
                autoComplete="off"
                value={testBody}
                onChange={(ev) => setTestBody(ev.target.value)}
              />
            </div>
          )}
          <button
            type="button"
            className="gc-btn gc-btn-primary gc-inspector-apply"
            disabled={testSending}
            onClick={() => void handleSendTest()}
            data-testid="gc-webhook-send"
          >
            {testSending ? t("app.inspector.webhookTestSending") : t("app.inspector.webhookTestSend")}
          </button>
          {testResult !== null && (
            <div className="gc-webhook-test-result" data-testid="gc-webhook-test-result">
              <p>
                <strong>{t("app.inspector.webhookTestStatus")}</strong> {testResult.status}{" "}
                &mdash; {testResult.durationMs}ms
              </p>
              <pre className="gc-inspector-data-textarea" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {testResult.body}
              </pre>
            </div>
          )}
          {testError !== null && (
            <p className="gc-inspector-edge-hint" role="alert" data-testid="gc-webhook-test-error">
              {testError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
