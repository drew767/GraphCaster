// Copyright GraphCaster. All Rights Reserved.

/** Max buffered out-of-order NDJSON lines per run before gap recovery. */
export const NDJSON_SEQ_REORDER_MAX_PENDING = 500;

/**
 * Parse monotonic broker `seq` from a single NDJSON line (stdout channel), if present.
 */
export function extractSeqFromNdjsonLine(line: string): number | null {
  const t = line.trim();
  if (t === "" || t[0] !== "{") {
    return null;
  }
  try {
    const o = JSON.parse(t) as unknown;
    if (o == null || typeof o !== "object" || Array.isArray(o)) {
      return null;
    }
    const seq = (o as { seq?: unknown }).seq;
    if (typeof seq !== "number" || !Number.isFinite(seq)) {
      return null;
    }
    return Math.trunc(seq);
  } catch {
    return null;
  }
}

export type NdjsonSeqReorderSink = {
  accept: (line: string) => void;
  reset: () => void;
};

/**
 * Buffer NDJSON run events and flush in `seq` order when the broker / Redis relay
 * delivers lines out of order. Lines without `seq` pass through immediately.
 */
export function createNdjsonSeqReorderSink(flush: (line: string) => void): NdjsonSeqReorderSink {
  /** Matches broker `SequenceGenerator`: first assigned seq is 1. */
  let nextSeq = 1;
  const pending = new Map<number, string>();

  const tryDrain = (): void => {
    while (pending.has(nextSeq)) {
      const ln = pending.get(nextSeq)!;
      pending.delete(nextSeq);
      flush(ln);
      nextSeq += 1;
    }
  };

  const recoverIfNeeded = (): void => {
    if (pending.size <= NDJSON_SEQ_REORDER_MAX_PENDING) {
      return;
    }
    const keys = [...pending.keys()].sort((a, b) => a - b);
    const m = keys[0];
    if (m != null && m > nextSeq) {
      nextSeq = m;
    }
    tryDrain();
  };

  return {
    accept(line: string): void {
      const seq = extractSeqFromNdjsonLine(line);
      if (seq === null) {
        flush(line);
        return;
      }
      if (seq < nextSeq) {
        return;
      }
      if (seq === nextSeq) {
        flush(line);
        nextSeq += 1;
        tryDrain();
        return;
      }
      pending.set(seq, line);
      recoverIfNeeded();
    },
    reset(): void {
      nextSeq = 1;
      pending.clear();
    },
  };
}
