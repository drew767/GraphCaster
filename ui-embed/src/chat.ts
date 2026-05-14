// Copyright GraphCaster. All Rights Reserved.

import type { EmbedConfig } from "./index";
import { parseSSEStream } from "./stream";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Build the chat panel DOM element. Returns the panel element and an
 * `appendMessage` / `appendDelta` API the bubble controller uses.
 */
export function createChatPanel(config: EmbedConfig): {
  panel: HTMLElement;
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
} {
  const theme = config.theme ?? "light";
  const position = config.position ?? "bottom-right";
  const primaryColor = config.primaryColor ?? (theme === "dark" ? "#7c3aed" : "#6366f1");

  const history: ChatMessage[] = [];

  const panel = document.createElement("div");
  panel.className = [
    "gc-embed-panel",
    `gc-embed-panel--${theme}`,
    `gc-embed-panel--${position}`,
    "gc-embed-panel--hidden",
  ].join(" ");
  panel.style.setProperty("--gc-primary", primaryColor);
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "GraphCaster chat");

  // Header
  const header = document.createElement("div");
  header.className = "gc-embed-header";

  const title = document.createElement("span");
  title.className = "gc-embed-header__title";
  title.textContent = "Chat";

  const closeBtn = document.createElement("button");
  closeBtn.className = "gc-embed-close-btn";
  closeBtn.type = "button";
  closeBtn.textContent = "×";
  closeBtn.setAttribute("aria-label", "Close chat");

  header.appendChild(title);
  header.appendChild(closeBtn);

  // Messages area
  const messagesArea = document.createElement("div");
  messagesArea.className = "gc-embed-messages";
  messagesArea.setAttribute("aria-live", "polite");

  if (config.welcomeMessage) {
    const welcome = document.createElement("div");
    welcome.className = "gc-embed-welcome";
    welcome.textContent = config.welcomeMessage;
    messagesArea.appendChild(welcome);
  }

  // Input area
  const inputArea = document.createElement("div");
  inputArea.className = "gc-embed-input-area";

  const textarea = document.createElement("textarea");
  textarea.className = "gc-embed-input";
  textarea.placeholder = "Type a message…";
  textarea.rows = 1;
  textarea.setAttribute("aria-label", "Chat message input");

  const sendBtn = document.createElement("button");
  sendBtn.className = "gc-embed-send-btn";
  sendBtn.type = "button";
  sendBtn.textContent = "↑";
  sendBtn.setAttribute("aria-label", "Send message");

  inputArea.appendChild(textarea);
  inputArea.appendChild(sendBtn);

  panel.appendChild(header);
  panel.appendChild(messagesArea);
  panel.appendChild(inputArea);

  function addMessageEl(role: "user" | "assistant", content: string): HTMLElement {
    const row = document.createElement("div");
    row.className = `gc-embed-msg gc-embed-msg--${role}`;
    const bubble = document.createElement("div");
    bubble.className = "gc-embed-msg__bubble";
    bubble.textContent = content;
    row.appendChild(bubble);
    messagesArea.appendChild(row);
    messagesArea.scrollTop = messagesArea.scrollHeight;
    return bubble;
  }

  let streaming = false;

  async function sendMessage(text: string): Promise<void> {
    if (!text.trim() || streaming) return;
    streaming = true;
    sendBtn.disabled = true;
    textarea.disabled = true;

    history.push({ role: "user", content: text });
    addMessageEl("user", text);

    const assistantRow = document.createElement("div");
    assistantRow.className = "gc-embed-msg gc-embed-msg--assistant gc-embed-msg--streaming";
    const assistantBubble = document.createElement("div");
    assistantBubble.className = "gc-embed-msg__bubble";
    assistantBubble.textContent = "";
    assistantRow.appendChild(assistantBubble);
    messagesArea.appendChild(assistantRow);
    messagesArea.scrollTop = messagesArea.scrollHeight;

    history.push({ role: "assistant", content: "" });
    const msgIdx = history.length - 1;

    try {
      const endpoint = buildEndpoint(config);
      const body = buildRequestBody(config, history.slice(0, msgIdx));

      const resp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!resp.ok || !resp.body) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const reader = resp.body.getReader();
      await parseSSEStream(reader, {
        onChunk(delta) {
          history[msgIdx].content += delta;
          assistantBubble.textContent = history[msgIdx].content;
          messagesArea.scrollTop = messagesArea.scrollHeight;
        },
        onDone() {
          assistantRow.classList.remove("gc-embed-msg--streaming");
        },
        onError(err) {
          assistantBubble.textContent = `Error: ${err.message}`;
          assistantRow.classList.remove("gc-embed-msg--streaming");
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      assistantBubble.textContent = `Error: ${msg}`;
      assistantRow.classList.remove("gc-embed-msg--streaming");
    } finally {
      streaming = false;
      sendBtn.disabled = false;
      textarea.disabled = false;
      textarea.focus();
    }
  }

  // Event wiring
  closeBtn.addEventListener("click", () => close());

  sendBtn.addEventListener("click", () => {
    const text = textarea.value;
    textarea.value = "";
    void sendMessage(text);
  });

  textarea.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const text = textarea.value;
      textarea.value = "";
      void sendMessage(text);
    }
  });

  let open_ = false;

  function open(): void {
    open_ = true;
    panel.classList.remove("gc-embed-panel--hidden");
    textarea.focus();
  }

  function close(): void {
    open_ = false;
    panel.classList.add("gc-embed-panel--hidden");
  }

  function isOpen(): boolean {
    return open_;
  }

  return { panel, open, close, isOpen };
}

function buildEndpoint(config: EmbedConfig): string {
  const base = config.apiBase.replace(/\/$/, "");
  if (config.shareLinkId) {
    return `${base}/public/${config.shareLinkId}/run`;
  }
  return `${base}/openai/chat/completions`;
}

function buildRequestBody(config: EmbedConfig, messages: ChatMessage[]): unknown {
  if (config.shareLinkId) {
    const last = messages[messages.length - 1];
    return { inputs: { message: last?.content ?? "" } };
  }
  return {
    model: `gc-graph:${config.graphId}`,
    stream: true,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  };
}
