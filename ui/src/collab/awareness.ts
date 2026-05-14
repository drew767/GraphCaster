// Copyright GraphCaster. All Rights Reserved.

export interface CollabAwarenessState {
  userId: string;
  name: string;
  color: string;
  cursor?: { x: number; y: number };
  selection?: string[];
}

const _THROTTLE_MS = Math.round(1000 / 30);

export function createAwarenessThrottle(
  publish: (patch: Partial<CollabAwarenessState>) => void,
): {
  onMouseMove(x: number, y: number): void;
  onSelectionChange(nodeIds: string[]): void;
  destroy(): void;
} {
  let _timer: ReturnType<typeof setTimeout> | null = null;
  let _pendingCursor: { x: number; y: number } | null = null;
  let _pendingSelection: string[] | null = null;

  function flush(): void {
    _timer = null;
    const patch: Partial<CollabAwarenessState> = {};
    if (_pendingCursor !== null) {
      patch.cursor = _pendingCursor;
      _pendingCursor = null;
    }
    if (_pendingSelection !== null) {
      patch.selection = _pendingSelection;
      _pendingSelection = null;
    }
    if (Object.keys(patch).length > 0) publish(patch);
  }

  function schedule(): void {
    if (_timer === null) {
      _timer = setTimeout(flush, _THROTTLE_MS);
    }
  }

  return {
    onMouseMove(x: number, y: number): void {
      _pendingCursor = { x, y };
      schedule();
    },
    onSelectionChange(nodeIds: string[]): void {
      _pendingSelection = nodeIds;
      schedule();
    },
    destroy(): void {
      if (_timer !== null) {
        clearTimeout(_timer);
        _timer = null;
      }
    },
  };
}
