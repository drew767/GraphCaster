// Copyright GraphCaster. All Rights Reserved.

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GC_RUN_BROKER_PREFIX?: string;
  readonly VITE_GC_RUN_BROKER_TOKEN?: string;
  /** When `ws`, dev UI uses WebSocket to the run broker instead of SSE (`sse` default). */
  readonly VITE_GC_RUN_TRANSPORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
