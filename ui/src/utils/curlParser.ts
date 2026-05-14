// Copyright GraphCaster. All Rights Reserved.

export interface CurlParseResult {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  queryParams?: Record<string, string>;
}

/**
 * Tokenise a shell-style command string into argv-style tokens.
 * Handles single and double quotes plus simple backslash escaping.
 * Strips backslash-newline continuations.
 */
export function tokenizeShell(input: string): string[] {
  const cleaned = input.replace(/\\\r?\n/g, " ").trim();
  const tokens: string[] = [];
  let i = 0;
  while (i < cleaned.length) {
    const ch = cleaned[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }
    let token = "";
    while (i < cleaned.length) {
      const c = cleaned[i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") {
        break;
      }
      if (c === "'") {
        i += 1;
        while (i < cleaned.length && cleaned[i] !== "'") {
          token += cleaned[i];
          i += 1;
        }
        i += 1; // closing quote
        continue;
      }
      if (c === '"') {
        i += 1;
        while (i < cleaned.length && cleaned[i] !== '"') {
          if (cleaned[i] === "\\" && i + 1 < cleaned.length) {
            token += cleaned[i + 1];
            i += 2;
            continue;
          }
          token += cleaned[i];
          i += 1;
        }
        i += 1;
        continue;
      }
      if (c === "\\" && i + 1 < cleaned.length) {
        token += cleaned[i + 1];
        i += 2;
        continue;
      }
      token += c;
      i += 1;
    }
    tokens.push(token);
  }
  return tokens;
}

export function parseCurl(input: string): CurlParseResult {
  const trimmed = input.trim();
  if (!/^curl\b/i.test(trimmed)) {
    throw new Error("Input does not start with curl");
  }
  const tokens = tokenizeShell(trimmed);
  if (tokens.length === 0 || tokens[0].toLowerCase() !== "curl") {
    throw new Error("Not a curl command");
  }

  let method: string | null = null;
  const headers: Record<string, string> = {};
  let body: string | undefined;
  let url: string | undefined;

  const takeNext = (i: number): { value: string | undefined; next: number } => {
    const next = tokens[i + 1];
    return { value: next, next: i + 1 };
  };

  for (let i = 1; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (tok === "-X" || tok === "--request") {
      const t = takeNext(i);
      if (t.value) {
        method = t.value.toUpperCase();
        i = t.next;
      }
      continue;
    }
    if (tok === "-H" || tok === "--header") {
      const t = takeNext(i);
      if (t.value) {
        const idx = t.value.indexOf(":");
        if (idx > 0) {
          const key = t.value.slice(0, idx).trim();
          const val = t.value.slice(idx + 1).trim();
          headers[key] = val;
        }
        i = t.next;
      }
      continue;
    }
    if (
      tok === "-d" ||
      tok === "--data" ||
      tok === "--data-raw" ||
      tok === "--data-binary" ||
      tok === "--data-urlencode"
    ) {
      const t = takeNext(i);
      if (t.value !== undefined) {
        body = body === undefined ? t.value : `${body}&${t.value}`;
        i = t.next;
      }
      continue;
    }
    if (tok === "--url") {
      const t = takeNext(i);
      if (t.value) {
        url = t.value;
        i = t.next;
      }
      continue;
    }
    if (tok === "-u" || tok === "--user") {
      const t = takeNext(i);
      if (t.value) {
        if (typeof btoa === "function") {
          headers["Authorization"] = `Basic ${btoa(t.value)}`;
        }
        i = t.next;
      }
      continue;
    }
    if (tok.startsWith("-") && tok !== "-" && !/^https?:/.test(tok)) {
      // Flag without value we care about; if it takes a value the cases above handled it.
      const valueTakingShort = ["-A", "-e", "-b", "-c", "-o", "-T", "-F"];
      if (valueTakingShort.includes(tok)) {
        i += 1; // skip its value
      }
      continue;
    }
    // Positional → URL.
    if (!url) {
      url = tok;
    }
  }

  if (!url) {
    throw new Error("curl command did not include a URL");
  }

  if (method === null) {
    method = body !== undefined ? "POST" : "GET";
  }

  return {
    url,
    method,
    headers,
    body,
  };
}

/**
 * Detect the format of an import payload.
 */
export type ImportFormat = "json" | "curl" | "templateUrl" | "unknown";

export function detectImportFormat(input: string): {
  format: ImportFormat;
  templateId?: string;
} {
  const trimmed = input.trim();
  if (!trimmed) return { format: "unknown" };
  if (trimmed.startsWith("{")) {
    try {
      JSON.parse(trimmed);
      return { format: "json" };
    } catch {
      // Not valid JSON; fall through.
    }
  }
  if (/^curl\b/i.test(trimmed)) {
    return { format: "curl" };
  }
  const m = trimmed.match(/^https?:\/\/[^\s]+\/(?:template|workflows|wf)\/(\d+)/i);
  if (m) {
    return { format: "templateUrl", templateId: m[1] };
  }
  return { format: "unknown" };
}
