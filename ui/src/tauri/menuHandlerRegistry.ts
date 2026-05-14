// Copyright GraphCaster. All Rights Reserved.

/**
 * Mutable registry that lets the active app shell expose named callbacks to
 * the native menu bridge. The bridge holds a stable reference to the registry
 * map and reads it on every native-menu dispatch, so handlers registered
 * later (e.g. after AppShell mounts) still fire.
 */
const handlerMap = new Map<string, () => void>();

export function registerMenuHandler(id: string, handler: () => void): () => void {
  handlerMap.set(id, handler);
  return () => {
    if (handlerMap.get(id) === handler) {
      handlerMap.delete(id);
    }
  };
}

export function registerMenuHandlers(
  entries: Readonly<Record<string, () => void>>,
): () => void {
  const unregs: Array<() => void> = [];
  for (const [id, handler] of Object.entries(entries)) {
    unregs.push(registerMenuHandler(id, handler));
  }
  return () => {
    for (const u of unregs) {
      u();
    }
  };
}

export function getMenuHandlersSnapshot(): Readonly<Record<string, () => void>> {
  const out: Record<string, () => void> = {};
  for (const [id, h] of handlerMap.entries()) {
    out[id] = h;
  }
  return out;
}

export function menuHandlersProxy(): Readonly<Record<string, () => void>> {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== "string") {
          return undefined;
        }
        return handlerMap.get(prop);
      },
      has(_target, prop) {
        return typeof prop === "string" && handlerMap.has(prop);
      },
    },
  ) as Readonly<Record<string, () => void>>;
}

export function clearMenuHandlers(): void {
  handlerMap.clear();
}
