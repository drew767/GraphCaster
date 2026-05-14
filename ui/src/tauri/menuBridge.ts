// Copyright GraphCaster. All Rights Reserved.

import type { EventCallback, UnlistenFn } from "@tauri-apps/api/event";

import { isTauriRuntime } from "../run/tauriEnv";

export type MenuEventPayload = { id: string };

export type MenuHandlers = Readonly<Record<string, () => void>>;

type ListenFn = <T>(event: string, handler: EventCallback<T>) => Promise<UnlistenFn>;

/**
 * Subscribes to native menu events emitted by the Tauri shell and dispatches
 * each event to the matching handler. Missing handlers are logged via
 * `console.warn`. In a non-Tauri (web) build this is a no-op and resolves to
 * an unsubscribe function that does nothing.
 *
 * The `listen` argument is for testing only; production callers should omit it.
 */
export async function startMenuBridge(
  handlers: MenuHandlers,
  listen?: ListenFn,
): Promise<UnlistenFn> {
  if (listen === undefined && !isTauriRuntime()) {
    return () => {};
  }
  const resolvedListen =
    listen ??
    (async <T,>(event: string, handler: EventCallback<T>) => {
      const mod = await import("@tauri-apps/api/event");
      return mod.listen<T>(event, handler);
    });

  return resolvedListen<MenuEventPayload>("menu", (event) => {
    dispatchMenuEvent(event.payload, handlers);
  });
}

export function dispatchMenuEvent(
  payload: MenuEventPayload | null | undefined,
  handlers: MenuHandlers,
): void {
  const id = payload?.id;
  if (typeof id !== "string" || id === "") {
    return;
  }
  const handler = handlers[id];
  if (!handler) {
    // eslint-disable-next-line no-console
    console.warn(`[menuBridge] no handler for "${id}"`);
    return;
  }
  try {
    handler();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[menuBridge] handler for "${id}" threw`, err);
  }
}
