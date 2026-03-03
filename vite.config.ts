import { defineConfig } from "vite";

export default defineConfig({
  base: "/ndlocr-lite-wasm/",
  server: {
    port: 6174,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  optimizeDeps: {
    exclude: ["onnxruntime-web"],
  },
  worker: {
    format: "es",
  },
});
