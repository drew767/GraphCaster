// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect } from "vitest";

import { parseCurl, detectImportFormat, tokenizeShell } from "./curlParser";

describe("tokenizeShell", () => {
  it("respects single and double quoted strings", () => {
    expect(tokenizeShell("curl -H 'X-A: 1' \"https://x.io\"")).toEqual([
      "curl",
      "-H",
      "X-A: 1",
      "https://x.io",
    ]);
  });
});

describe("parseCurl", () => {
  it("parses a POST with JSON body and headers", () => {
    const out = parseCurl(
      "curl -X POST -H 'Content-Type: application/json' -d '{\"a\":1}' https://example.com",
    );
    expect(out.method).toBe("POST");
    expect(out.url).toBe("https://example.com");
    expect(out.headers["Content-Type"]).toBe("application/json");
    expect(out.body).toBe('{"a":1}');
  });

  it("defaults to GET when no method specified and no body", () => {
    const out = parseCurl("curl https://example.com");
    expect(out.method).toBe("GET");
    expect(out.url).toBe("https://example.com");
  });

  it("infers POST when body is present without -X", () => {
    const out = parseCurl("curl --data 'name=alice' https://example.com");
    expect(out.method).toBe("POST");
    expect(out.body).toBe("name=alice");
  });

  it("throws on non-curl input", () => {
    expect(() => parseCurl("wget https://example.com")).toThrow();
  });
});

describe("detectImportFormat", () => {
  it("detects JSON", () => {
    expect(detectImportFormat('{"nodes":[]}').format).toBe("json");
  });

  it("detects curl", () => {
    expect(detectImportFormat("curl https://x.io").format).toBe("curl");
  });

  it("detects template URL", () => {
    const r = detectImportFormat("https://example.com/template/42");
    expect(r.format).toBe("templateUrl");
    expect(r.templateId).toBe("42");
  });

  it("returns unknown for plain text", () => {
    expect(detectImportFormat("hello world").format).toBe("unknown");
  });
});
