import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "dev-refresh-csp",
      apply: "serve",
      // Dev-only CSP relaxations: React refresh's inline preamble and the HMR socket.
      transformIndexHtml: (html) =>
        html
          .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
          .replace(
            "connect-src 'self' eva: blob:",
            "connect-src 'self' eva: blob: ws://127.0.0.1:5173",
          ),
    },
  ],
  base: "./",
  server: { port: 5173, strictPort: true, host: "127.0.0.1" },
  build: { chunkSizeWarningLimit: 1300, assetsInlineLimit: 0 },
});
