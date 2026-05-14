// Copyright GraphCaster. All Rights Reserved.

import type { JSX, ReactNode } from "react";

import { safeExternalHttpUrl } from "../../../lib/safeExternalUrl";

type InlineToken =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "link"; text: string; href: string }
  | { type: "bold"; children: InlineToken[] }
  | { type: "em"; children: InlineToken[] };

function tokenizeInline(src: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let i = 0;
  let buf = "";
  const flushBuf = (): void => {
    if (buf.length > 0) {
      tokens.push({ type: "text", value: buf });
      buf = "";
    }
  };
  while (i < src.length) {
    const ch = src[i];
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i) {
        flushBuf();
        tokens.push({ type: "code", value: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    } else if (ch === "[") {
      const close = src.indexOf("]", i + 1);
      if (close > i && src[close + 1] === "(") {
        const paren = src.indexOf(")", close + 2);
        if (paren > close) {
          flushBuf();
          const text = src.slice(i + 1, close);
          const href = src.slice(close + 2, paren).trim();
          tokens.push({ type: "link", text, href });
          i = paren + 1;
          continue;
        }
      }
    } else if (ch === "*" && src[i + 1] === "*") {
      const end = src.indexOf("**", i + 2);
      if (end > i + 1) {
        flushBuf();
        tokens.push({ type: "bold", children: tokenizeInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    } else if (ch === "*") {
      const end = src.indexOf("*", i + 1);
      if (end > i) {
        flushBuf();
        tokens.push({ type: "em", children: tokenizeInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    buf += ch;
    i += 1;
  }
  flushBuf();
  return tokens;
}

function renderInline(tokens: InlineToken[], keyPrefix: string): ReactNode[] {
  return tokens.map((tok, idx) => {
    const key = `${keyPrefix}-${idx}`;
    if (tok.type === "text") return <span key={key}>{tok.value}</span>;
    if (tok.type === "code") return <code key={key} className="gc-md-code">{tok.value}</code>;
    if (tok.type === "bold") return <strong key={key}>{renderInline(tok.children, key)}</strong>;
    if (tok.type === "em") return <em key={key}>{renderInline(tok.children, key)}</em>;
    if (tok.type === "link") {
      const safe = safeExternalHttpUrl(tok.href);
      if (safe == null) {
        return <span key={key}>{tok.text}</span>;
      }
      return (
        <a key={key} href={safe} target="_blank" rel="noopener noreferrer" className="gc-md-link">
          {tok.text}
        </a>
      );
    }
    return null;
  });
}

type Block =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "code"; lang: string; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] };

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence != null) {
      const lang = fence[1] ?? "";
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1; // closing fence
      blocks.push({ kind: "code", lang, text: body.join("\n") });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading != null) {
      const level = heading[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ kind: "heading", level, text: heading[2] });
      i += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i += 1;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }
    const paraLines: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i += 1;
    }
    blocks.push({ kind: "paragraph", text: paraLines.join(" ") });
  }
  return blocks;
}

export type SimpleMarkdownProps = {
  source: string;
  className?: string;
};

export function SimpleMarkdown({ source, className }: SimpleMarkdownProps): JSX.Element {
  const blocks = parseBlocks(source);
  return (
    <div className={className ?? "gc-md"} data-testid="gc-simple-markdown">
      {blocks.map((b, i) => {
        const key = `b-${i}`;
        if (b.kind === "heading") {
          const HTag = `h${b.level}` as keyof JSX.IntrinsicElements;
          return (
            <HTag key={key} className={`gc-md-h gc-md-h${b.level}`}>
              {renderInline(tokenizeInline(b.text), key)}
            </HTag>
          );
        }
        if (b.kind === "paragraph") {
          return (
            <p key={key} className="gc-md-p">
              {renderInline(tokenizeInline(b.text), key)}
            </p>
          );
        }
        if (b.kind === "code") {
          return (
            <pre key={key} className="gc-md-pre" data-lang={b.lang}>
              <code>{b.text}</code>
            </pre>
          );
        }
        if (b.kind === "ul") {
          return (
            <ul key={key} className="gc-md-ul">
              {b.items.map((it, idx) => (
                <li key={`${key}-li-${idx}`}>{renderInline(tokenizeInline(it), `${key}-li-${idx}`)}</li>
              ))}
            </ul>
          );
        }
        if (b.kind === "ol") {
          return (
            <ol key={key} className="gc-md-ol">
              {b.items.map((it, idx) => (
                <li key={`${key}-li-${idx}`}>{renderInline(tokenizeInline(it), `${key}-li-${idx}`)}</li>
              ))}
            </ol>
          );
        }
        return null;
      })}
    </div>
  );
}

export const __test__ = { parseBlocks, tokenizeInline };
