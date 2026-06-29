// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { GraphDocumentJson, GraphNodeJson } from "../../../graph/types";
import { isPlainObject } from "../../../graph/inspectorValidation";

export type HttpRequestInspectorProps = {
  node: GraphNodeJson;
  graphDocument: GraphDocumentJson;
  runLocked: boolean;
  workspaceLinked: boolean;
  onApplyNodeData: (nodeId: string, data: Record<string, unknown>) => void;
};

type AuthKind = "none" | "basic" | "bearer";

export function HttpRequestInspector({ node, runLocked, onApplyNodeData }: HttpRequestInspectorProps) {
  const { t } = useTranslation();
  const raw: Record<string, unknown> = isPlainObject(node.data) ? node.data : {};

  const [httpUrl, setHttpUrl] = useState("");
  const [httpMethod, setHttpMethod] = useState("GET");
  const [httpHeadersJson, setHttpHeadersJson] = useState("{}");
  const [httpBody, setHttpBody] = useState("");
  const [httpTimeoutSec, setHttpTimeoutSec] = useState("30");
  const [httpVerifyTls, setHttpVerifyTls] = useState(true);
  const [httpParseResponse, setHttpParseResponse] = useState<"auto" | "json" | "text">("auto");
  const [httpAuthKind, setHttpAuthKind] = useState<AuthKind>("none");
  const [httpAuthUser, setHttpAuthUser] = useState("");
  const [httpAuthPassword, setHttpAuthPassword] = useState("");
  const [httpAuthToken, setHttpAuthToken] = useState("");

  useEffect(() => {
    const r = raw;
    setHttpUrl(typeof r.url === "string" ? r.url : "");
    const m0 =
      typeof r.method === "string" && r.method.trim() !== "" ? r.method.trim().toUpperCase() : "GET";
    setHttpMethod(m0);
    const hh = r.headers;
    try {
      setHttpHeadersJson(
        JSON.stringify(hh != null && typeof hh === "object" && !Array.isArray(hh) ? hh : {}, null, 2),
      );
    } catch {
      setHttpHeadersJson("{}");
    }
    setHttpBody(typeof r.body === "string" ? r.body : "");
    const hts = r.timeoutSec;
    setHttpTimeoutSec(
      typeof hts === "number" && Number.isFinite(hts)
        ? String(hts)
        : typeof hts === "string" && hts.trim() !== ""
          ? hts.trim()
          : "30",
    );
    setHttpVerifyTls(r.verifyTls !== false);
    const pr = typeof r.parseResponseBody === "string" ? r.parseResponseBody.trim().toLowerCase() : "auto";
    setHttpParseResponse(pr === "json" || pr === "text" ? pr : "auto");
    const auth = r.auth;
    if (isPlainObject(auth)) {
      const at = String(auth.type || "").toLowerCase();
      if (at === "basic") {
        setHttpAuthKind("basic");
        setHttpAuthUser(typeof auth.username === "string" ? auth.username : "");
        setHttpAuthPassword(typeof auth.password === "string" ? auth.password : "");
        setHttpAuthToken("");
      } else if (at === "bearer") {
        setHttpAuthKind("bearer");
        setHttpAuthToken(typeof auth.token === "string" ? auth.token : "");
        setHttpAuthUser("");
        setHttpAuthPassword("");
      } else {
        setHttpAuthKind("none");
      }
    } else {
      setHttpAuthKind("none");
    }
  }, [node.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyFields = () => {
    if (runLocked) {
      return;
    }
    let headersObj: Record<string, unknown>;
    try {
      const p = JSON.parse(httpHeadersJson);
      if (!isPlainObject(p)) {
        throw new Error("not_object");
      }
      headersObj = p;
    } catch {
      window.alert(t("app.inspector.httpRequestHeadersInvalid"));
      return;
    }
    const toN = Number.parseFloat(httpTimeoutSec);
    const timeoutSec = Number.isFinite(toN) ? Math.min(3600, Math.max(0.5, toN)) : 30;
    const base = isPlainObject(raw) ? { ...raw } : {};
    const next: Record<string, unknown> = {
      ...base,
      title: typeof base.title === "string" && base.title.trim() !== "" ? base.title : "HTTP request",
      url: httpUrl,
      method: httpMethod.trim() !== "" ? httpMethod.trim().toUpperCase() : "GET",
      headers: headersObj,
      timeoutSec,
      verifyTls: httpVerifyTls,
      parseResponseBody: httpParseResponse,
    };
    if (httpBody.trim() !== "") {
      next.body = httpBody;
    } else {
      delete next.body;
    }
    if (httpAuthKind === "basic") {
      next.auth = { type: "basic", username: httpAuthUser, password: httpAuthPassword };
    } else if (httpAuthKind === "bearer") {
      next.auth = { type: "bearer", token: httpAuthToken };
    } else {
      delete next.auth;
    }
    onApplyNodeData(node.id, next);
  };

  return (
    <div className="gc-inspector-mcp">
      <div className="gc-inspector-row gc-inspector-row--field">
        <label className="gc-inspector-k" htmlFor="gc-sub-http-url">
          {t("app.inspector.httpRequestUrl")}
        </label>
        <input
          id="gc-sub-http-url"
          className="gc-inspector-condition-input"
          disabled={runLocked}
          value={httpUrl}
          onChange={(ev) => {
            setHttpUrl(ev.target.value);
          }}
        />
      </div>
      <div className="gc-inspector-row gc-inspector-row--field">
        <label className="gc-inspector-k" htmlFor="gc-sub-http-method">
          {t("app.inspector.httpRequestMethod")}
        </label>
        <select
          id="gc-sub-http-method"
          className="gc-inspector-condition-input"
          disabled={runLocked}
          value={httpMethod}
          onChange={(ev) => {
            setHttpMethod(ev.target.value);
          }}
        >
          <option value="GET">GET</option>
          <option value="HEAD">HEAD</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="PATCH">PATCH</option>
          <option value="DELETE">DELETE</option>
          <option value="OPTIONS">OPTIONS</option>
        </select>
      </div>
      <div className="gc-inspector-row gc-inspector-row--field">
        <label className="gc-inspector-k" htmlFor="gc-sub-http-headers">
          {t("app.inspector.httpRequestHeadersJson")}
        </label>
        <textarea
          id="gc-sub-http-headers"
          className="gc-inspector-condition-input"
          disabled={runLocked}
          rows={4}
          value={httpHeadersJson}
          onChange={(ev) => {
            setHttpHeadersJson(ev.target.value);
          }}
        />
      </div>
      <div className="gc-inspector-row gc-inspector-row--field">
        <label className="gc-inspector-k" htmlFor="gc-sub-http-body">
          {t("app.inspector.httpRequestBody")}
        </label>
        <textarea
          id="gc-sub-http-body"
          className="gc-inspector-condition-input"
          disabled={runLocked}
          rows={4}
          value={httpBody}
          onChange={(ev) => {
            setHttpBody(ev.target.value);
          }}
        />
      </div>
      <div className="gc-inspector-row gc-inspector-row--field">
        <label className="gc-inspector-k" htmlFor="gc-sub-http-timeout">
          {t("app.inspector.httpRequestTimeoutSec")}
        </label>
        <input
          id="gc-sub-http-timeout"
          type="text"
          inputMode="decimal"
          className="gc-inspector-condition-input"
          disabled={runLocked}
          value={httpTimeoutSec}
          onChange={(ev) => {
            setHttpTimeoutSec(ev.target.value);
          }}
        />
      </div>
      <div className="gc-inspector-row gc-inspector-row--field">
        <label className="gc-inspector-k" htmlFor="gc-sub-http-verify">
          {t("app.inspector.httpRequestVerifyTls")}
        </label>
        <input
          id="gc-sub-http-verify"
          type="checkbox"
          disabled={runLocked}
          checked={httpVerifyTls}
          onChange={(ev) => {
            setHttpVerifyTls(ev.target.checked);
          }}
        />
      </div>
      <div className="gc-inspector-row gc-inspector-row--field">
        <label className="gc-inspector-k" htmlFor="gc-sub-http-parse">
          {t("app.inspector.httpRequestParseBody")}
        </label>
        <select
          id="gc-sub-http-parse"
          className="gc-inspector-condition-input"
          disabled={runLocked}
          value={httpParseResponse}
          onChange={(ev) => {
            const v = ev.target.value;
            setHttpParseResponse(v === "json" || v === "text" ? v : "auto");
          }}
        >
          <option value="auto">{t("app.inspector.httpRequestParseAuto")}</option>
          <option value="json">{t("app.inspector.httpRequestParseJson")}</option>
          <option value="text">{t("app.inspector.httpRequestParseText")}</option>
        </select>
      </div>
      <div className="gc-inspector-row gc-inspector-row--field">
        <label className="gc-inspector-k" htmlFor="gc-sub-http-auth">
          {t("app.inspector.httpRequestAuthKind")}
        </label>
        <select
          id="gc-sub-http-auth"
          className="gc-inspector-condition-input"
          disabled={runLocked}
          value={httpAuthKind}
          onChange={(ev) => {
            const v = ev.target.value;
            setHttpAuthKind(v === "basic" || v === "bearer" ? v : "none");
          }}
        >
          <option value="none">{t("app.inspector.httpRequestAuthNone")}</option>
          <option value="basic">{t("app.inspector.httpRequestAuthBasic")}</option>
          <option value="bearer">{t("app.inspector.httpRequestAuthBearer")}</option>
        </select>
      </div>
      {httpAuthKind === "basic" ? (
        <>
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-k" htmlFor="gc-sub-http-auth-user">
              {t("app.inspector.httpRequestAuthUsername")}
            </label>
            <input
              id="gc-sub-http-auth-user"
              className="gc-inspector-condition-input"
              disabled={runLocked}
              value={httpAuthUser}
              onChange={(ev) => {
                setHttpAuthUser(ev.target.value);
              }}
            />
          </div>
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-k" htmlFor="gc-sub-http-auth-pass">
              {t("app.inspector.httpRequestAuthPassword")}
            </label>
            <input
              id="gc-sub-http-auth-pass"
              type="password"
              className="gc-inspector-condition-input"
              disabled={runLocked}
              value={httpAuthPassword}
              onChange={(ev) => {
                setHttpAuthPassword(ev.target.value);
              }}
            />
          </div>
        </>
      ) : null}
      {httpAuthKind === "bearer" ? (
        <div className="gc-inspector-row gc-inspector-row--field">
          <label className="gc-inspector-k" htmlFor="gc-sub-http-auth-tok">
            {t("app.inspector.httpRequestAuthToken")}
          </label>
          <input
            id="gc-sub-http-auth-tok"
            type="password"
            className="gc-inspector-condition-input"
            disabled={runLocked}
            value={httpAuthToken}
            onChange={(ev) => {
              setHttpAuthToken(ev.target.value);
            }}
          />
        </div>
      ) : null}
      <button
        type="button"
        className="gc-btn gc-inspector-apply"
        disabled={runLocked}
        onClick={applyFields}
      >
        {t("app.inspector.applyHttpRequestSettings")}
      </button>
    </div>
  );
}
