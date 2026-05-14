// Copyright GraphCaster. All Rights Reserved.

import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["iife"],
      name: "GraphCasterEmbed",
      fileName: () => "embed.js",
    },
    outDir: "dist",
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
    minify: true,
    target: "es2020",
  },
});
