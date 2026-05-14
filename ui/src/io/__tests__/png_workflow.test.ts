// Copyright GraphCaster. All Rights Reserved.

import { beforeAll, describe, expect, it } from "vitest";

/**
 * jsdom does not implement File.prototype.text() or File.prototype.arrayBuffer().
 * Polyfill them using the underlying Blob data before running tests.
 */
beforeAll(() => {
  if (!File.prototype.text) {
    File.prototype.text = function (this: File): Promise<string> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(this);
      });
    };
  }
  if (!File.prototype.arrayBuffer) {
    File.prototype.arrayBuffer = function (this: File): Promise<ArrayBuffer> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    };
  }
});

import { extractPngChunks, injectTextChunk, isPngBytes, parseTextChunk } from "../png_chunks";
import { importWorkflowFromFile } from "../png_workflow_import";
import type { GraphDocumentJson } from "../../graph/types";

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Minimal valid GraphDocumentJson for testing. */
function minimalDoc(): GraphDocumentJson {
  return {
    schemaVersion: 1,
    meta: { graphId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "Test" },
    nodes: [{ id: "start1", type: "start", position: { x: 0, y: 0 } }],
    edges: [],
  };
}

/**
 * Build a minimal but structurally valid PNG Uint8Array.
 * Contains: signature, IHDR, IDAT (empty), IEND.
 */
function buildMinimalPng(): Uint8Array {
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  function uint32BE(n: number): Uint8Array {
    return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
  }

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();

  function crc32(buf: Uint8Array): number {
    let crc = 0xffffffff;
    for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function chunk(name: string, data: Uint8Array): Uint8Array {
    const typeBytes = new TextEncoder().encode(name);
    const crcInput = new Uint8Array(4 + data.length);
    crcInput.set(typeBytes, 0);
    crcInput.set(data, 4);
    const out = new Uint8Array(12 + data.length);
    out.set(uint32BE(data.length), 0);
    out.set(typeBytes, 4);
    out.set(data, 8);
    out.set(uint32BE(crc32(crcInput)), 8 + data.length);
    return out;
  }

  // IHDR: 13 bytes (1x1 pixel, 8-bit RGBA)
  const ihdrData = new Uint8Array([
    0, 0, 0, 1, // width
    0, 0, 0, 1, // height
    8, // bit depth
    2, // color type (RGB)
    0, // compression
    0, // filter
    0, // interlace
  ]);
  const ihdr = chunk("IHDR", ihdrData);

  // IDAT: minimal compressed data for 1x1 RGB (deflate with zlib wrapper)
  // Raw deflate for 1x1 filter-0 + 3 bytes RGB = [0, 0,0,0]
  // zlib: CMF=0x78 FLG=0x9c (default compression, check bits)
  // This isn't a valid image but isPngBytes only checks the signature.
  const idatData = new Uint8Array([0x78, 0x9c, 0x62, 0x60, 0x60, 0x60, 0x00, 0x00, 0x00, 0x04, 0x00, 0x01]);
  const idat = chunk("IDAT", idatData);

  const iend = chunk("IEND", new Uint8Array(0));

  const total = sig.length + ihdr.length + idat.length + iend.length;
  const png = new Uint8Array(total);
  let off = 0;
  png.set(sig, off); off += sig.length;
  png.set(ihdr, off); off += ihdr.length;
  png.set(idat, off); off += idat.length;
  png.set(iend, off);
  return png;
}

/** Create a File from bytes. */
function makeFile(bytes: Uint8Array, name: string, type: string): File {
  return new File([bytes], name, { type });
}

/** Create a JSON File from an object. */
function makeJsonFile(obj: unknown, name = "graph.json"): File {
  const text = JSON.stringify(obj);
  return new File([text], name, { type: "application/json" });
}

// ─── png_chunks ─────────────────────────────────────────────────────────────

describe("isPngBytes", () => {
  it("returns true for a valid PNG", () => {
    expect(isPngBytes(buildMinimalPng())).toBe(true);
  });

  it("returns false for too-short array", () => {
    expect(isPngBytes(new Uint8Array([137, 80, 78]))).toBe(false);
  });

  it("returns false for non-PNG bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(isPngBytes(bytes)).toBe(false);
  });
});

describe("extractPngChunks", () => {
  it("returns empty array for non-PNG", () => {
    expect(extractPngChunks(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]))).toEqual([]);
  });

  it("extracts IHDR, IDAT, IEND from a minimal PNG", () => {
    const chunks = extractPngChunks(buildMinimalPng());
    const names = chunks.map((c) => c.name);
    expect(names).toContain("IHDR");
    expect(names).toContain("IDAT");
    expect(names).toContain("IEND");
  });
});

describe("injectTextChunk + extractPngChunks round-trip", () => {
  it("inserts a tEXt chunk before IDAT", () => {
    const png = buildMinimalPng();
    const out = injectTextChunk(png, "workflow", "hello");
    const chunks = extractPngChunks(out);
    const textChunks = chunks.filter((c) => c.name === "tEXt");
    expect(textChunks.length).toBe(1);
    const parsed = parseTextChunk(textChunks[0].data);
    expect(parsed?.key).toBe("workflow");
    expect(parsed?.text).toBe("hello");
  });

  it("replaces existing tEXt chunk with same key", () => {
    const png = buildMinimalPng();
    const once = injectTextChunk(png, "workflow", "first");
    const twice = injectTextChunk(once, "workflow", "second");
    const chunks = extractPngChunks(twice);
    const textChunks = chunks.filter((c) => c.name === "tEXt");
    expect(textChunks.length).toBe(1);
    const parsed = parseTextChunk(textChunks[0].data);
    expect(parsed?.text).toBe("second");
  });

  it("preserves PNG structure (signature, IHDR, IDAT, IEND still present)", () => {
    const png = buildMinimalPng();
    const out = injectTextChunk(png, "workflow", "{}");
    expect(isPngBytes(out)).toBe(true);
    const names = extractPngChunks(out).map((c) => c.name);
    expect(names).toContain("IHDR");
    expect(names).toContain("IDAT");
    expect(names).toContain("IEND");
  });
});

describe("parseTextChunk", () => {
  it("returns null for data with no NUL byte", () => {
    const data = new TextEncoder().encode("nokey");
    expect(parseTextChunk(data)).toBeNull();
  });

  it("parses key and text correctly", () => {
    const data = new Uint8Array([107, 101, 121, 0, 118, 97, 108]); // "key\0val"
    const result = parseTextChunk(data);
    expect(result?.key).toBe("key");
    expect(result?.text).toBe("val");
  });
});

// ─── png_workflow full round-trip ───────────────────────────────────────────

describe("PNG workflow round-trip (inject → extract → parse)", () => {
  it("recovers an equal GraphDocumentJson after inject + extract", () => {
    const doc = minimalDoc();
    const png = buildMinimalPng();
    const pngWithWf = injectTextChunk(png, "workflow", JSON.stringify(doc));

    const chunks = extractPngChunks(pngWithWf);
    const wfChunk = chunks.find(
      (c) => c.name === "tEXt" && parseTextChunk(c.data)?.key === "workflow",
    );
    expect(wfChunk).toBeDefined();
    const parsed = parseTextChunk(wfChunk!.data);
    const recovered = JSON.parse(parsed!.text) as GraphDocumentJson;
    expect(recovered.meta?.graphId).toBe(doc.meta?.graphId);
    expect(recovered.nodes?.length).toBe(doc.nodes?.length);
  });
});

// ─── importWorkflowFromFile ──────────────────────────────────────────────────

describe("importWorkflowFromFile — JSON", () => {
  it("returns parsed doc for a valid JSON file", async () => {
    const doc = minimalDoc();
    const file = makeJsonFile(doc);
    const result = await importWorkflowFromFile(file);
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.doc.meta?.graphId).toBe(doc.meta?.graphId);
    }
  });

  it("returns { ok: false, reason: invalid_json } for non-JSON text", async () => {
    const file = new File(["not json {{{"], "bad.json", { type: "application/json" });
    const result = await importWorkflowFromFile(file);
    expect(result?.ok).toBe(false);
    if (result && !result.ok) {
      expect(result.reason).toBe("invalid_json");
    }
  });

  it("returns { ok: false, reason: parse_error } for JSON that fails schema validation", async () => {
    // A JSON object that does not satisfy parseGraphDocumentJsonResult (bad node)
    const badDoc = { nodes: [{ id: 123, type: "start" }] };
    const file = makeJsonFile(badDoc);
    const result = await importWorkflowFromFile(file);
    expect(result?.ok).toBe(false);
    if (result && !result.ok) {
      expect(result.reason).toBe("parse_error");
    }
  });
});

describe("importWorkflowFromFile — PNG with embedded workflow", () => {
  it("returns parsed doc for a PNG with a workflow tEXt chunk", async () => {
    const doc = minimalDoc();
    const png = buildMinimalPng();
    const pngWithWf = injectTextChunk(png, "workflow", JSON.stringify(doc));
    const file = makeFile(pngWithWf, "canvas.png", "image/png");
    const result = await importWorkflowFromFile(file);
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.doc.meta?.graphId).toBe(doc.meta?.graphId);
    }
  });

  it("returns { ok: false, reason: no_workflow_chunk } for PNG without workflow chunk", async () => {
    const png = buildMinimalPng();
    const file = makeFile(png, "plain.png", "image/png");
    const result = await importWorkflowFromFile(file);
    expect(result?.ok).toBe(false);
    if (result && !result.ok) {
      expect(result.reason).toBe("no_workflow_chunk");
    }
  });

  it("returns { ok: false } for invalid PNG bytes (not a PNG)", async () => {
    const badBytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const file = makeFile(badBytes, "bad.png", "image/png");
    const result = await importWorkflowFromFile(file);
    expect(result?.ok).toBe(false);
  });

  it("returns null for unsupported file type", async () => {
    const file = new File(["data"], "image.webp", { type: "image/webp" });
    const result = await importWorkflowFromFile(file);
    expect(result).toBeNull();
  });
});
