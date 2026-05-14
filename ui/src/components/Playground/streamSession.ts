// Copyright GraphCaster. All Rights Reserved.

export interface StreamCallbacks {
  onChunk: (text: string) => void;
  onDone: (tokensUsed?: number) => void;
  onError: (err: Error) => void;
}

/**
 * POST to the OpenAI-compat chat completions endpoint with `stream: true`,
 * parse SSE, and call back for each text delta.
 */
export async function streamChatSession(
  graphId: string,
  sessionId: string,
  messages: Array<{ role: string; content: string }>,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const body = JSON.stringify({
    model: `gc-graph:${graphId}`,
    stream: true,
    session_id: sessionId,
    messages,
  });

  let response: Response;
  try {
    response = await fetch("/api/v1/openai/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal,
    });
  } catch (err) {
    callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    return;
  }

  if (!response.ok) {
    callbacks.onError(new Error(`HTTP ${response.status}`));
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    callbacks.onError(new Error("No response body"));
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let totalTokens: number | undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") {
          callbacks.onDone(totalTokens);
          return;
        }
        try {
          const parsed: unknown = JSON.parse(data);
          if (parsed != null && typeof parsed === "object" && "choices" in parsed) {
            const choices = (parsed as { choices: unknown[] }).choices;
            if (Array.isArray(choices) && choices.length > 0) {
              const delta = (choices[0] as { delta?: { content?: string } }).delta;
              if (delta?.content) {
                callbacks.onChunk(delta.content);
              }
            }
            const usage = (parsed as { usage?: { total_tokens?: number } }).usage;
            if (usage?.total_tokens != null) {
              totalTokens = usage.total_tokens;
            }
          }
        } catch {
          // non-JSON line — skip
        }
      }
    }
  } catch (err) {
    if ((err as { name?: string }).name !== "AbortError") {
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
    return;
  }

  callbacks.onDone(totalTokens);
}
