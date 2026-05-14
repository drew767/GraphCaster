// Copyright GraphCaster. All Rights Reserved.

export type EmbedCommand =
  | { type: "open-workflow"; workflowId: string }
  | { type: "create-workflow"; from?: "blank" | "template"; templateId?: string }
  | { type: "run-workflow"; workflowId: string }
  | { type: "set-readonly"; readOnly: boolean }
  | { type: "navigate"; path: string };

export type EmbedEvent =
  | { type: "ready" }
  | { type: "workflow-saved"; workflowId: string }
  | { type: "workflow-deleted"; workflowId: string }
  | { type: "run-finished"; workflowId: string; runId: string; status: string }
  | { type: "navigation"; path: string };

export interface EmbedHostHandlers {
  onCommand?: (command: EmbedCommand) => void;
  navigate?: (path: string) => void;
  setReadOnly?: (readOnly: boolean) => void;
  openWorkflow?: (workflowId: string) => void;
  createWorkflow?: (
    from: "blank" | "template" | undefined,
    templateId: string | undefined,
  ) => void;
  runWorkflow?: (workflowId: string) => void;
}

export interface InitEmbedHostOptions {
  origin?: string;
  handlers?: EmbedHostHandlers;
  /** Override `window` for tests. Defaults to `globalThis.window`. */
  window?: Window & typeof globalThis;
}

export interface EmbedHostHandle {
  dispose: () => void;
  emit: (event: EmbedEvent) => void;
}

function isEmbedCommand(value: unknown): value is EmbedCommand {
  if (!value || typeof value !== "object") return false;
  const t = (value as { type?: unknown }).type;
  return (
    t === "open-workflow" ||
    t === "create-workflow" ||
    t === "run-workflow" ||
    t === "set-readonly" ||
    t === "navigate"
  );
}

/**
 * Initialise the postMessage bridge between this app (running inside an iframe)
 * and its parent window. Returns a disposer that should be called when the
 * bridge is no longer needed (e.g. component unmount).
 */
export function initEmbedHost(options: InitEmbedHostOptions = {}): EmbedHostHandle {
  const win = options.window ?? (typeof window !== "undefined" ? window : undefined);
  if (!win) {
    return { dispose: () => undefined, emit: () => undefined };
  }
  const parent = win.parent;
  const expectedOrigin = options.origin;
  const handlers = options.handlers ?? {};

  function emit(event: EmbedEvent): void {
    if (parent && parent !== win) {
      try {
        parent.postMessage(event, expectedOrigin ?? "*");
      } catch {
        /* ignore */
      }
    }
  }

  function dispatch(command: EmbedCommand): void {
    handlers.onCommand?.(command);
    switch (command.type) {
      case "navigate":
        handlers.navigate?.(command.path);
        emit({ type: "navigation", path: command.path });
        break;
      case "open-workflow":
        if (handlers.openWorkflow) {
          handlers.openWorkflow(command.workflowId);
        } else {
          handlers.navigate?.(`/workflow/${command.workflowId}`);
        }
        break;
      case "create-workflow":
        if (handlers.createWorkflow) {
          handlers.createWorkflow(command.from, command.templateId);
        } else {
          handlers.navigate?.("/workflow/new");
        }
        break;
      case "run-workflow":
        handlers.runWorkflow?.(command.workflowId);
        break;
      case "set-readonly":
        handlers.setReadOnly?.(command.readOnly);
        break;
    }
  }

  function onMessage(ev: MessageEvent): void {
    if (expectedOrigin && ev.origin !== expectedOrigin) return;
    if (!isEmbedCommand(ev.data)) return;
    dispatch(ev.data);
  }

  win.addEventListener("message", onMessage as EventListener);

  // Notify parent we are ready.
  emit({ type: "ready" });

  return {
    dispose: () => {
      win.removeEventListener("message", onMessage as EventListener);
    },
    emit,
  };
}
