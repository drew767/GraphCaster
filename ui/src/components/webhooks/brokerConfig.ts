// Copyright GraphCaster. All Rights Reserved.

import { getRunBrokerBasePath } from "../../run/webRunBroker";

export interface BrokerConfig {
  publicUrl: string;
  version: string;
  features: {
    scheduler: boolean;
    fsWatcher: boolean;
    poller: boolean;
    redisBus: boolean;
    collab: boolean;
  };
}

let _cached: BrokerConfig | null = null;
let _pending: Promise<BrokerConfig> | null = null;

const DEFAULT_CONFIG: BrokerConfig = {
  publicUrl: "",
  version: "",
  features: {
    scheduler: false,
    fsWatcher: false,
    poller: false,
    redisBus: false,
    collab: false,
  },
};

export async function fetchBrokerConfig(): Promise<BrokerConfig> {
  if (_cached !== null) return _cached;
  if (_pending !== null) return _pending;
  _pending = (async () => {
    try {
      const base = getRunBrokerBasePath();
      const res = await fetch(`${base}/api/v1/config`);
      if (!res.ok) return DEFAULT_CONFIG;
      const body = (await res.json()) as Partial<BrokerConfig>;
      const cfg: BrokerConfig = {
        publicUrl: typeof body.publicUrl === "string" ? body.publicUrl : "",
        version: typeof body.version === "string" ? body.version : "",
        features: {
          scheduler: Boolean(body.features?.scheduler),
          fsWatcher: Boolean(body.features?.fsWatcher),
          poller: Boolean(body.features?.poller),
          redisBus: Boolean(body.features?.redisBus),
          collab: Boolean(body.features?.collab),
        },
      };
      _cached = cfg;
      return cfg;
    } catch {
      return DEFAULT_CONFIG;
    } finally {
      _pending = null;
    }
  })();
  return _pending;
}

/** Compute the webhook URL for a given path. Uses publicUrl from broker config, falling back to window.location.origin. */
export function buildWebhookUrl(publicUrl: string, path: string): string {
  const base =
    publicUrl.trim() ||
    (typeof window !== "undefined" ? window.location.origin : "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}/webhook${normalizedPath}`;
}

/** Reset the cache (for tests). */
export function _resetBrokerConfigCache(): void {
  _cached = null;
  _pending = null;
}
