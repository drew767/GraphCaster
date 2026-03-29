// Copyright GraphCaster. All Rights Reserved.

import type { ReactNode } from "react";

function lineLooksLikeJsonObjectOrArray(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith("{") || t.startsWith("[");
}

/**
 * Best-effort JSON syntax highlighting for a single console line.
 * Falls back to plain text when the line is not valid JSON.
 */
export function jsonHighlightedConsoleLine(line: string): ReactNode {
  if (!lineLooksLikeJsonObjectOrArray(line)) {
    return line;
  }
  try {
    JSON.parse(line);
  } catch {
    return line;
  }

  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;

  const pushText = (s: string, cls: string) => {
    if (s.length === 0) {
      return;
    }
    out.push(
      <span key={key++} className={cls}>
        {s}
      </span>,
    );
  };

  const readString = (): void => {
    const start = i;
    i += 1;
    while (i < line.length) {
      const c = line[i];
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === '"') {
        i += 1;
        break;
      }
      i += 1;
    }
    pushText(line.slice(start, i), "gc-json-str");
  };

  while (i < line.length) {
    const c = line[i];
    if (c === '"') {
      readString();
      continue;
    }
    if (/\s/.test(c)) {
      let j = i + 1;
      while (j < line.length && /\s/.test(line[j])) {
        j += 1;
      }
      pushText(line.slice(i, j), "gc-json-ws");
      i = j;
      continue;
    }
    if ("{}[],:".includes(c)) {
      pushText(c, "gc-json-punct");
      i += 1;
      continue;
    }
    if (c === "-" || (c >= "0" && c <= "9")) {
      let j = i + 1;
      while (j < line.length && /[0-9.eE+-]/.test(line[j])) {
        j += 1;
      }
      pushText(line.slice(i, j), "gc-json-num");
      i = j;
      continue;
    }
    if (/[a-z]/i.test(c)) {
      let j = i + 1;
      while (j < line.length && /[a-z]/i.test(line[j])) {
        j += 1;
      }
      const word = line.slice(i, j);
      const cls =
        word === "true" || word === "false" || word === "null" ? "gc-json-kw" : "gc-json-id";
      pushText(word, cls);
      i = j;
      continue;
    }
    pushText(c, "gc-json-etc");
    i += 1;
  }

  return <>{out}</>;
}
