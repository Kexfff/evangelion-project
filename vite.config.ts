import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "dev-refresh-csp",
      apply: "serve",
      transformIndexHtml: (html) =>
        html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
    },
  ],
  base: "./",
  server: { port: 5173, strictPort: true, host: "127.0.0.1" },
  build: { chunkSizeWarningLimit: 1300, assetsInlineLimit: 0 },
});
