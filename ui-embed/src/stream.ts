// Copyright GraphCaster. All Rights Reserved.

/**
 * Minimal SSE / streaming fetch parser for the embed widget.
 * Reads a ReadableStream from a fetch response body and calls `onChunk`
 * for each delta string received, then `onDone` when the stream ends.
 */

export interface StreamCallbacks {
  onChunk: (delta: string) => void;
  onDone: () => void;
  onError: (err: Error) => void;
}

/**
 * Parse an OpenAI-compatible streaming response (text/event-stream).
 * Each `data:` line is expected to be a JSON object of shape:
 *   { choices: [{ delta: { content: string } }] }
 * The sentinel `data: [DONE]` terminates the stream.
 */
export async function parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  callbacks: StreamCallbacks,
): Promise<void> {
  const decoder = new TextDecoder();
  let buf = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") {
          callbacks.onDone();
          return;
        }
        try {
          const obj = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const content = obj?.choices?.[0]?.delta?.content;
          if (typeof content === "string" && content.length > 0) {
            callbacks.onChunk(content);
          }
        } catch {
          // ignore non-JSON lines
        }
      }
    }
    callbacks.onDone();
  } catch (err) {
    callbacks.onError(err instanceof Error ? err : new Error(String(err)));
  }
}
