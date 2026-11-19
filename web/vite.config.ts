import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({
  plugins: [tanstackStart(), react()],
  optimizeDeps: { exclude: ["@napi-rs/canvas", "playwright-core"] },
  ssr: { external: ["@napi-rs/canvas", "playwright-core"] },
  resolve: {
    dedupe: ["react", "react-dom", "three"],
  },
  server: { host: "127.0.0.1", port: 4310, strictPort: true },
});
