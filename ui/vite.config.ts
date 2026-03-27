// Copyright Aura. All Rights Reserved.

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
    fs: {
      allow: [uiRoot, graphCasterRoot],
    },
  },
});
