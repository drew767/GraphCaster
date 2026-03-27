// Copyright GraphCaster. All Rights Reserved.

import path from "path";
import { fileURLToPath } from "url";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const uiRoot = path.dirname(fileURLToPath(import.meta.url));
const graphCasterRoot = path.resolve(uiRoot, "..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, uiRoot, "");
  const brokerTarget = env.VITE_GC_RUN_BROKER_TARGET || "http://127.0.0.1:9847";

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@schemas": path.join(graphCasterRoot, "schemas"),
      },
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      fs: {
        allow: [uiRoot, graphCasterRoot],
      },
      proxy: {
        "/gc-run-broker": {
          target: brokerTarget,
          changeOrigin: true,
          rewrite: (p) => {
            const stripped = p.replace(/^\/gc-run-broker/, "");
            return stripped === "" ? "/" : stripped;
          },
        },
      },
    },
    preview: {
      host: "127.0.0.1",
      port: 4173,
      strictPort: true,
    },
  };
});
