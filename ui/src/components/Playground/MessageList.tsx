// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useRef } from "react";
import type { ChatMessage as ChatMessageType } from "./chatHistoryStore";
import { ChatMessage } from "./ChatMessage";

type Props = {
  messages: ChatMessageType[];
};

export function MessageList({ messages }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof bottomRef.current?.scrollIntoView === "function") {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length, messages[messages.length - 1]?.content]);

  return (
    <div className="gc-pg-msglist" data-testid="gc-pg-msglist" role="log" aria-live="polite">
      {messages.map((msg) => (
        <ChatMessage key={msg.id} message={msg} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
