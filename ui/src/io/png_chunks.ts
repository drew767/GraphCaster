// Copyright GraphCaster. All Rights Reserved.

/**
 * Minimal PNG chunk utilities (vanilla DataView — no extra deps).
 *
 * PNG binary layout:
 *   8-byte signature
 *   repeated: 4-byte length | 4-byte type | <length> bytes data | 4-byte CRC
 */

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export type PngChunk = {
  name: string;
  data: Uint8Array;
};

/** Returns true when the first 8 bytes match the PNG magic bytes. */
export function isPngBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 8) {
    return false;
  }
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Extract all chunks from a PNG byte array.
 * Returns an empty array when the bytes do not look like a PNG.
 */
export function extractPngChunks(bytes: Uint8Array): PngChunk[] {
  if (!isPngBytes(bytes)) {
    return [];
  }
  const chunks: PngChunk[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length =
      ((bytes[offset] << 24) |
        (bytes[offset + 1] << 16) |
        (bytes[offset + 2] << 8) |
        bytes[offset + 3]) >>>
      0;
    const nameBytes = bytes.slice(offset + 4, offset + 8);
    const name = String.fromCharCode(...nameBytes);
    const data = bytes.slice(offset + 8, offset + 8 + length);
    chunks.push({ name, data });
    offset += 12 + length;
    if (name === "IEND") {
      break;
    }
  }
  return chunks;
}

/**
 * CRC-32 table (polynomial 0xEDB88320, standard PNG CRC).
 * Built once at module load time.
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint32BE(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, false);
}

/**
 * Encode a single PNG chunk into bytes.
 * Output layout: [length 4B][type 4B][data NB][crc 4B]
 */
function encodeChunk(name: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array([
    name.charCodeAt(0),
    name.charCodeAt(1),
    name.charCodeAt(2),
    name.charCodeAt(3),
  ]);
  const chunkBuf = new Uint8Array(12 + data.length);
  const view = new DataView(chunkBuf.buffer);
  writeUint32BE(view, 0, data.length);
  chunkBuf.set(typeBytes, 4);
  chunkBuf.set(data, 8);
  // CRC covers type + data
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  writeUint32BE(view, 8 + data.length, crc32(crcInput));
  return chunkBuf;
}

/**
 * Build a tEXt chunk: keyword\0text, both Latin-1.
 * `text` must not contain NUL characters.
 */
function buildTextChunk(key: string, text: string): Uint8Array {
  const enc = new TextEncoder();
  const keyBytes = enc.encode(key);
  const textBytes = enc.encode(text);
  const data = new Uint8Array(keyBytes.length + 1 + textBytes.length);
  data.set(keyBytes, 0);
  data[keyBytes.length] = 0;
  data.set(textBytes, keyBytes.length + 1);
  return encodeChunk("tEXt", data);
}

/**
 * Re-assemble PNG bytes, inserting a tEXt chunk with `key`/`text`
 * right before the IDAT chunk (ComfyUI convention).
 * If the PNG already contains a tEXt chunk with the same key it is replaced.
 */
export function injectTextChunk(pngBytes: Uint8Array, key: string, text: string): Uint8Array {
  if (!isPngBytes(pngBytes)) {
    throw new Error("injectTextChunk: not a PNG");
  }

  const newChunkBytes = buildTextChunk(key, text);

  // Collect raw chunk slices and insert before first IDAT
  const parts: Uint8Array[] = [pngBytes.slice(0, 8)];
  let offset = 8;
  let inserted = false;

  while (offset + 12 <= pngBytes.length) {
    const length =
      ((pngBytes[offset] << 24) |
        (pngBytes[offset + 1] << 16) |
        (pngBytes[offset + 2] << 8) |
        pngBytes[offset + 3]) >>>
      0;
    const name = String.fromCharCode(
      pngBytes[offset + 4],
      pngBytes[offset + 5],
      pngBytes[offset + 6],
      pngBytes[offset + 7],
    );
    const chunkTotal = 12 + length;
    const rawChunk = pngBytes.slice(offset, offset + chunkTotal);

    // Skip existing tEXt chunk with same key (replace)
    if (name === "tEXt") {
      const dataStart = offset + 8;
      const nullPos = pngBytes.indexOf(0, dataStart);
      if (nullPos !== -1 && nullPos < dataStart + length) {
        const existingKey = new TextDecoder().decode(pngBytes.slice(dataStart, nullPos));
        if (existingKey === key) {
          offset += chunkTotal;
          continue;
        }
      }
    }

    if (!inserted && name === "IDAT") {
      parts.push(newChunkBytes);
      inserted = true;
    }
    parts.push(rawChunk);
    offset += chunkTotal;
    if (name === "IEND") {
      break;
    }
  }

  if (!inserted) {
    // Fallback: append before IEND (should not happen in a valid PNG)
    parts.push(newChunkBytes);
  }

  const totalLength = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(totalLength);
  let pos = 0;
  for (const part of parts) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

/**
 * Parse a tEXt chunk data payload into key + text.
 * Returns null on malformed input.
 */
export function parseTextChunk(data: Uint8Array): { key: string; text: string } | null {
  const nullPos = data.indexOf(0);
  if (nullPos === -1) {
    return null;
  }
  const key = new TextDecoder().decode(data.slice(0, nullPos));
  const text = new TextDecoder().decode(data.slice(nullPos + 1));
  return { key, text };
}
