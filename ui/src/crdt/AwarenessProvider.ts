// Copyright GraphCaster. All Rights Reserved.

/** Local placeholder for collaborative cursor state (replace with y-protocols/awareness when syncing). */
export type AwarenessPayload = { userId?: string; x?: number; y?: number };

export class LocalAwarenessStub {
  private _local: AwarenessPayload = {};

  getLocalState(): AwarenessPayload {
    return { ...this._local };
  }

  setLocalState(patch: AwarenessPayload): void {
    this._local = { ...this._local, ...patch };
  }
}
