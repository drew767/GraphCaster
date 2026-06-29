// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { GraphDocumentJson, GraphNodeJson } from "../../../graph/types";
import { isPlainObject } from "../../../graph/inspectorValidation";

export type RagQueryInspectorProps = {
  node: GraphNodeJson;
  graphDocument: GraphDocumentJson;
  runLocked: boolean;
  workspaceLinked: boolean;
  onApplyNodeData: (nodeId: string, data: Record<string, unknown>) => void;
};

type AuthKind = "none" | "basic" | "bearer";

export function RagQueryInspector({ node, runLocked, onApplyNodeData }: RagQueryInspectorProps) {
  const { t } = useTranslation();
  const raw: Record<string, unknown> = isPlainObject(node.data) ? node.data : {};

  const [ragVectorBackend, setRagVectorBackend] = useState<"http" | "memory">("http");
  const [ragUrl, setRagUrl] = useState("");
  const [ragQuery, setRagQuery] = useState("");
  const [ragCollectionId, setRagCollectionId] = useState("");
  const [ragTopK, setRagTopK] = useState("5");
  const [ragMethod, setRagMethod] = useState("POST");
  const [ragHeadersJson, setRagHeadersJson] = useState("{}");
  const [ragBody, setRagBody] = useState("");
  const [ragTimeoutSec, setRagTimeoutSec] = useState("60");
  const [ragVerifyTls, setRagVerifyTls] = useState(true);
  const [ragParseResponse, setRagParseResponse] = useState<"auto" | "json" | "text">("auto");
  const [httpAuthKind, setHttpAuthKind] = useState<AuthKind>("none");
  const [httpAuthUser, setHttpAuthUser] = useState("");
  const [httpAuthPassword, setHttpAuthPassword] = useState("");
  const [httpAuthToken, setHttpAuthToken] = useState("");

  useEffect(() => {
    const r = raw;
    const vb = String((r as Record<string, unknown>).vectorBackend ?? "").trim().toLowerCase();
    setRagVectorBackend(vb === "memory" ? "memory" : "http");
    setRagUrl(typeof r.url === "string" ? r.url : "");
    setRagQuery(typeof r.query === "string" ? r.query : "");
    setRagCollectionId(typeof r.collectionId === "string" ? r.collectionId : "");
    const tk = r.topK;
    setRagTopK(
      typeof tk === "number" && Number.isFinite(tk)
        ? String(Math.trunc(tk))
        : typeof tk === "string" && tk.trim() !== ""
          ? tk.trim()
          : "5",
    );
    const rm = typeof r.method === "string" && r.method.trim() !== "" ? r.method.trim().toUpperCase() : "POST";
    setRagMethod(rm);
    const rh = r.headers;
    try {
      setRagHeadersJson(
        JSON.stringify(rh != null && typeof rh === "object" && !Array.isArray(rh) ? rh : {}, null, 2),
      );
    } catch {
      setRagHeadersJson("{}");
    }
    setRagBody(typeof r.body === "string" ? r.body : "");
    const rts = r.timeoutSec;
    setRagTimeoutSec(
      typeof rts === "number" && Number.isFinite(rts)
        ? String(rts)
        : typeof rts === "string" && rts.trim() !== ""
          ? rts.trim()
          : "60",
    );
    setRagVerifyTls(r.verifyTls !== false);
    const rpr = typeof r.parseResponseBody === "string" ? r.parseResponseBody.trim().toLowerCase() : "auto";
    setRagParseResponse(rpr === "json" || rpr === "text" ? rpr : "auto");
    const rauth = r.auth;
    if (isPlainObject(rauth)) {
      const at = String(rauth.type || "").toLowerCase();
      if (at === "basic") {
        setHttpAuthKind("basic");
        setHttpAuthUser(typeof rauth.username === "string" ? rauth.username : "");
        setHttpAuthPassword(typeof rauth.password === "string" ? rauth.password : "");
      } else if (at === "bearer") {
        setHttpAuthKind("bearer");
        setHttpAuthToken(typeof rauth.token === "string" ? rauth.token : "");
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
    const toK = Number.parseInt(ragTopK, 10);
    const topK = Number.isFinite(toK) ? Math.min(100, Math.max(1, toK)) : 5;
    const base = isPlainObject(raw) ? { ...raw } : {};
    const title = typeof base.title === "string" && base.title.trim() !== "" ? base.title : "RAG query";
    const next: Record<string, unknown> = { ...base, title, query: ragQuery, topK };
    if (ragCollectionId.trim() !== "") {
      next.collectionId = ragCollectionId;
    } else {
      delete next.collectionId;
    }
    if (ragVectorBackend === "memory") {
      next.vectorBackend = "memory";
      delete next.url;
      delete next.method;
      delete next.headers;
      delete next.body;
      delete next.auth;
      delete next.timeoutSec;
      delete next.verifyTls;
      delete next.parseResponseBody;
      onApplyNodeData(node.id, next);
      return;
    }
    delete next.vectorBackend;
    let headersObj: Record<string, unknown>;
    try {
      const p = JSON.parse(ragHeadersJson);
      if (!isPlainObject(p)) {
        throw new Error("not_object");
      }
      headersObj = p;
    } catch {
      window.alert(t("app.inspector.httpRequestHeadersInvalid"));
      return;
    }
    const toN = Number.parseFloat(ragTimeoutSec);
    const timeoutSec = Number.isFinite(toN) ? Math.min(3600, Math.max(0.5, toN)) : 60;
    next.url = ragUrl;
    next.method = ragMethod.trim() !== "" ? ragMethod.trim().toUpperCase() : "POST";
    next.headers = headersObj;
    next.timeoutSec = timeoutSec;
    next.verifyTls = ragVerifyTls;
    next.parseResponseBody = ragParseResponse;
    if (ragBody.trim() !== "") {
      next.body = ragBody;
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
        <label className="gc-inspector-k" htmlFor="gc-sub-rag-vb">
          {t("app.inspector.ragQueryVectorBackend")}
        </label>
        <select
          id="gc-sub-rag-vb"
          className="gc-inspector-condition-input"
          disabled={runLocked}
          value={ragVectorBackend}
          onChange={(ev) => {
            setRagVectorBackend(ev.target.value === "memory" ? "memory" : "http");
          }}
        >
          <option value="http">{t("app.inspector.ragQueryVectorBackendHttp")}</option>
          <option value="memory">{t("app.inspector.ragQueryVectorBackendMemory")}</option>
        </select>
      </div>
      {ragVectorBackend !== "memory" ? (
        <div className="gc-inspector-row gc-inspector-row--field">
          <label className="gc-inspector-k" htmlFor="gc-sub-rag-url">
            {t("app.inspector.ragQueryUrl")}
          </label>
          <input
            id="gc-sub-rag-url"
            className="gc-inspector-condition-input"
            disabled={runLocked}
            value={ragUrl}
            onChange={(ev) => {
              setRagUrl(ev.target.value);
            }}
          />
        </div>
      ) : null}
      <div className="gc-inspector-row gc-inspector-row--field">
        <label className="gc-inspector-k" htmlFor="gc-sub-rag-q">
          {t("app.inspector.ragQueryQueryText")}
        </label>
        <textarea
          id="gc-sub-rag-q"
          className="gc-inspector-condition-input"
          disabled={runLocked}
          rows={3}
          value={ragQuery}
          onChange={(ev) => {
            setRagQuery(ev.target.value);
          }}
        />
      </div>
      <div className="gc-inspector-row gc-inspector-row--field">
        <label className="gc-inspector-k" htmlFor="gc-sub-rag-col">
          {t("app.inspector.ragQueryCollectionId")}
        </label>
        <input
          id="gc-sub-rag-col"
          className="gc-inspector-condition-input"
          disabled={runLocked}
          value={ragCollectionId}
          onChange={(ev) => {
            setRagCollectionId(ev.target.value);
          }}
        />
      </div>
      <div className="gc-inspector-row gc-inspector-row--field">
        <label className="gc-inspector-k" htmlFor="gc-sub-rag-k">
          {t("app.inspector.ragQueryTopK")}
        </label>
        <input
          id="gc-sub-rag-k"
          type="text"
          inputMode="numeric"
          className="gc-inspector-condition-input"
          disabled={runLocked}
          value={ragTopK}
          onChange={(ev) => {
            setRagTopK(ev.target.value);
          }}
        />
      </div>
      {ragVectorBackend !== "memory" ? (
        <>
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-k" htmlFor="gc-sub-rag-m">
              {t("app.inspector.httpRequestMethod")}
            </label>
            <select
              id="gc-sub-rag-m"
              className="gc-inspector-condition-input"
              disabled={runLocked}
              value={ragMethod}
              onChange={(ev) => {
                setRagMethod(ev.target.value);
              }}
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </select>
          </div>
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-k" htmlFor="gc-sub-rag-h">
              {t("app.inspector.httpRequestHeadersJson")}
            </label>
            <textarea
              id="gc-sub-rag-h"
              className="gc-inspector-condition-input"
              disabled={runLocked}
              rows={3}
              value={ragHeadersJson}
              onChange={(ev) => {
                setRagHeadersJson(ev.target.value);
              }}
            />
          </div>
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-k" htmlFor="gc-sub-rag-b">
              {t("app.inspector.httpRequestBody")}
            </label>
            <textarea
              id="gc-sub-rag-b"
              className="gc-inspector-condition-input"
              disabled={runLocked}
              rows={3}
              value={ragBody}
              onChange={(ev) => {
                setRagBody(ev.target.value);
              }}
            />
          </div>
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-k" htmlFor="gc-sub-rag-to">
              {t("app.inspector.httpRequestTimeoutSec")}
            </label>
            <input
              id="gc-sub-rag-to"
              type="text"
              inputMode="decimal"
              className="gc-inspector-condition-input"
              disabled={runLocked}
              value={ragTimeoutSec}
              onChange={(ev) => {
                setRagTimeoutSec(ev.target.value);
              }}
            />
          </div>
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-k" htmlFor="gc-sub-rag-tls">
              {t("app.inspector.httpRequestVerifyTls")}
            </label>
            <input
              id="gc-sub-rag-tls"
              type="checkbox"
              disabled={runLocked}
              checked={ragVerifyTls}
              onChange={(ev) => {
                setRagVerifyTls(ev.target.checked);
              }}
            />
          </div>
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-k" htmlFor="gc-sub-rag-pr">
              {t("app.inspector.httpRequestParseBody")}
            </label>
            <select
              id="gc-sub-rag-pr"
              className="gc-inspector-condition-input"
              disabled={runLocked}
              value={ragParseResponse}
              onChange={(ev) => {
                const v = ev.target.value;
                setRagParseResponse(v === "json" || v === "text" ? v : "auto");
              }}
            >
              <option value="auto">{t("app.inspector.httpRequestParseAuto")}</option>
              <option value="json">{t("app.inspector.httpRequestParseJson")}</option>
              <option value="text">{t("app.inspector.httpRequestParseText")}</option>
            </select>
          </div>
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-k" htmlFor="gc-sub-rag-auth">
              {t("app.inspector.httpRequestAuthKind")}
            </label>
            <select
              id="gc-sub-rag-auth"
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
                <label className="gc-inspector-k" htmlFor="gc-sub-rag-au">
                  {t("app.inspector.httpRequestAuthUsername")}
                </label>
                <input
                  id="gc-sub-rag-au"
                  className="gc-inspector-condition-input"
                  disabled={runLocked}
                  value={httpAuthUser}
                  onChange={(ev) => {
                    setHttpAuthUser(ev.target.value);
                  }}
                />
              </div>
              <div className="gc-inspector-row gc-inspector-row--field">
                <label className="gc-inspector-k" htmlFor="gc-sub-rag-ap">
                  {t("app.inspector.httpRequestAuthPassword")}
                </label>
                <input
                  id="gc-sub-rag-ap"
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
              <label className="gc-inspector-k" htmlFor="gc-sub-rag-at">
                {t("app.inspector.httpRequestAuthToken")}
              </label>
              <input
                id="gc-sub-rag-at"
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
        </>
      ) : null}
      <button
        type="button"
        className="gc-btn gc-inspector-apply"
        disabled={runLocked}
        onClick={applyFields}
      >
        {t("app.inspector.applyRagQuerySettings")}
      </button>
    </div>
  );
}
