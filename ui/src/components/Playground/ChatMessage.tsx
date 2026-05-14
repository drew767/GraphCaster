// Copyright GraphCaster. All Rights Reserved.

import type { ChatMessage as ChatMessageType } from "./chatHistoryStore";

type Props = {
  message: ChatMessageType;
};

/** Minimal inline markdown: fenced code blocks, inline code, bold, italic. */
function renderMarkdown(text: string): React.ReactNode {
  // Split on fenced code blocks
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("```")) {
      const firstNewline = part.indexOf("\n");
      const lang = firstNewline > 3 ? part.slice(3, firstNewline).trim() : "";
      const code = part.slice(firstNewline > 3 ? firstNewline + 1 : 3, -3);
      return (
        <pre key={idx} className="gc-pg-msg__code-block" data-lang={lang || undefined}>
          <code>{code}</code>
        </pre>
      );
    }
    // inline code
    const inlineParts = part.split(/(`[^`]+`)/g);
    return inlineParts.map((span, j) => {
      if (span.startsWith("`") && span.endsWith("`")) {
        return <code key={`${idx}-${j}`} className="gc-pg-msg__inline-code">{span.slice(1, -1)}</code>;
      }
      // bold + italic via simple split
      const boldItalic = span.split(/(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*)/g);
      return boldItalic.map((piece, k) => {
        if (piece.startsWith("***") && piece.endsWith("***")) {
          return <strong key={`${idx}-${j}-${k}`}><em>{piece.slice(3, -3)}</em></strong>;
        }
        if (piece.startsWith("**") && piece.endsWith("**")) {
          return <strong key={`${idx}-${j}-${k}`}>{piece.slice(2, -2)}</strong>;
        }
        if (piece.startsWith("*") && piece.endsWith("*")) {
          return <em key={`${idx}-${j}-${k}`}>{piece.slice(1, -1)}</em>;
        }
        return <span key={`${idx}-${j}-${k}`}>{piece}</span>;
      });
    });
  });
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function ChatMessage({ message }: Props) {
  return (
    <div
      className={`gc-pg-msg gc-pg-msg--${message.role}`}
      data-testid={`gc-pg-msg-${message.id}`}
    >
      <div className="gc-pg-msg__bubble">
        <div className="gc-pg-msg__content" data-testid="gc-pg-msg-content">
          {renderMarkdown(message.content)}
          {message.streaming ? (
            <span className="gc-pg-msg__typing-cursor" aria-hidden="true">▍</span>
          ) : null}
        </div>
        <div className="gc-pg-msg__meta">
          <span className="gc-pg-msg__time">{formatTime(message.timestamp)}</span>
          {message.tokensUsed != null ? (
            <span className="gc-pg-msg__tokens" data-testid="gc-pg-msg-tokens">
              {message.tokensUsed} tokens
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
