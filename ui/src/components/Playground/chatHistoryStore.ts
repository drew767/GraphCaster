// Copyright GraphCaster. All Rights Reserved.

import { create } from "zustand";

export type MessageRole = "user" | "assistant" | "system";

export interface ChatFile {
  name: string;
  mimeType: string;
  base64: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  tokensUsed?: number;
  files?: ChatFile[];
  /** True while streaming is in progress. */
  streaming?: boolean;
}

interface ChatHistoryState {
  sessionId: string;
  messages: ChatMessage[];
  /** Append or create a new message. Returns the message id. */
  addMessage: (msg: Omit<ChatMessage, "id">) => string;
  /** Append streamed text chunk to last assistant message. */
  appendChunk: (msgId: string, chunk: string) => void;
  /** Finalize last assistant message (clear streaming flag, set token count). */
  finalizeMessage: (msgId: string, tokensUsed?: number) => void;
  /** Wipe messages and generate a fresh session id. */
  newSession: () => void;
  clearHistory: () => void;
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export const useChatHistory = create<ChatHistoryState>((set) => ({
  sessionId: makeId(),
  messages: [],

  addMessage: (msg) => {
    const id = makeId();
    set((state) => ({ messages: [...state.messages, { ...msg, id }] }));
    return id;
  },

  appendChunk: (msgId, chunk) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === msgId ? { ...m, content: m.content + chunk } : m,
      ),
    }));
  },

  finalizeMessage: (msgId, tokensUsed) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === msgId ? { ...m, streaming: false, tokensUsed } : m,
      ),
    }));
  },

  newSession: () => {
    set({ sessionId: makeId(), messages: [] });
  },

  clearHistory: () => {
    set({ messages: [] });
  },
}));
