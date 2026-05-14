// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";

import { useChatHistory, type ChatFile } from "./chatHistoryStore";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { streamChatSession } from "./streamSession";
import type { GraphDocumentJson } from "../../graph/types";

type Props = {
  open: boolean;
  onClose: () => void;
  graphDocument: GraphDocumentJson;
};

function resolveGraphId(doc: GraphDocumentJson): string {
  return (doc.meta?.graphId ?? doc.graphId ?? "").trim();
}

export function isGraphChatable(doc: GraphDocumentJson): boolean {
  if (doc.meta?.kind === "chat") return true;
  const startNode = (doc.nodes ?? []).find((n) => n.type === "start");
  if (startNode?.data?.mode === "chat") return true;
  return false;
}

export function Playground({ open, onClose, graphDocument }: Props) {
  const { t } = useTranslation();
  const {
    sessionId,
    messages,
    addMessage,
    appendChunk,
    finalizeMessage,
    newSession,
    clearHistory,
  } = useChatHistory();
  const abortRef = useRef<AbortController | null>(null);
  const isStreaming = messages.some((m) => m.streaming);

  const graphId = resolveGraphId(graphDocument);

  const handleSend = useCallback(
    (text: string, files: ChatFile[]) => {
      if (isStreaming) return;

      addMessage({
        role: "user",
        content: text,
        timestamp: Date.now(),
        files: files.length > 0 ? files : undefined,
      });

      const history = useChatHistory.getState().messages;
      const openAiMessages = history.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const assistantId = addMessage({
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        streaming: true,
      });

      const controller = new AbortController();
      abortRef.current = controller;

      void streamChatSession(
        graphId,
        sessionId,
        openAiMessages,
        {
          onChunk: (chunk) => appendChunk(assistantId, chunk),
          onDone: (tokens) => finalizeMessage(assistantId, tokens),
          onError: (err) => {
            appendChunk(assistantId, `\n\n[Error: ${err.message}]`);
            finalizeMessage(assistantId);
          },
        },
        controller.signal,
      );
    },
    [isStreaming, addMessage, appendChunk, finalizeMessage, graphId, sessionId],
  );

  const handleNewSession = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    newSession();
  }, [newSession]);

  const handleClearHistory = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    clearHistory();
  }, [clearHistory]);

  if (!open) return null;

  const shortSessionId = sessionId.length > 12 ? sessionId.slice(-12) : sessionId;

  return (
    <aside
      className="gc-playground"
      aria-label={t("app.playground.title")}
      data-testid="gc-playground"
    >
      <div className="gc-playground__header">
        <span className="gc-playground__title">{t("app.playground.title")}</span>
        <span className="gc-playground__session-id" title={sessionId}>
          {shortSessionId}
        </span>
        <button
          type="button"
          className="gc-playground__btn"
          onClick={handleNewSession}
          data-testid="gc-pg-new-session-btn"
        >
          {t("app.playground.newSession")}
        </button>
        <button
          type="button"
          className="gc-playground__btn"
          onClick={handleClearHistory}
          data-testid="gc-pg-clear-btn"
        >
          {t("app.playground.clearHistory")}
        </button>
        <button
          type="button"
          className="gc-playground__close"
          aria-label={t("app.playground.closeAria")}
          onClick={onClose}
          data-testid="gc-pg-close-btn"
        >
          ×
        </button>
      </div>
      <MessageList messages={messages} />
      <MessageInput onSend={handleSend} disabled={isStreaming} />
    </aside>
  );
}
