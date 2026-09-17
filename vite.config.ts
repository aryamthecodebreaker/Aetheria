import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/ws": {
        target: "ws://localhost:7777",
        ws: true
      }
    }
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2000
  },
  worker: {
    format: "es"
  }
});
