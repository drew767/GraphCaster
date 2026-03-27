// Copyright GraphCaster. All Rights Reserved.

import path from "path";
import { fileURLToPath } from "url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const uiRoot = path.dirname(fileURLToPath(import.meta.url));
const graphCasterRoot = path.resolve(uiRoot, "..");

export default defineConfig({
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
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
});
