// Copyright GraphCaster. All Rights Reserved.

/**
 * Lightweight facade for single-node "Test step" requests dispatched from
 * the NDV header. The full runtime wires this into the broker; in tests we
 * subscribe to the queue.
 */

export interface SingleStepRequest {
  nodeId: string;
  requestedAt: number;
}

type Listener = (req: SingleStepRequest) => void;

const queue: SingleStepRequest[] = [];
const listeners = new Set<Listener>();

export function runSingleNode(nodeId: string): SingleStepRequest {
  const req: SingleStepRequest = { nodeId, requestedAt: Date.now() };
  queue.push(req);
  // eslint-disable-next-line no-console
  console.info("[runStore] single-step requested for", nodeId);
  for (const l of listeners) {
    try {
      l(req);
    } catch {
      // ignore listener failure
    }
  }
  return req;
}

export function peekSingleStepQueue(): readonly SingleStepRequest[] {
  return queue.slice();
}

export function drainSingleStepQueue(): SingleStepRequest[] {
  const out = queue.slice();
  queue.length = 0;
  return out;
}

export function subscribeSingleStep(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const runStore = {
  runSingleNode,
  peekSingleStepQueue,
  drainSingleStepQueue,
  subscribeSingleStep,
};
