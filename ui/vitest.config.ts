// Copyright GraphCaster. All Rights Reserved.

import path from "node:path";

import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [svgr({ include: "**/*.svg?react" }), react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@schemas": path.resolve(__dirname, "../schemas"),
    },
  },
});
