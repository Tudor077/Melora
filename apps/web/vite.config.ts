import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Expose Tauri environment variables (TAURI_ENV_*) to the frontend
  envPrefix: ["VITE_", "TAURI_ENV_"],
  plugins: [react()],
  resolve: {
    alias: {
      "@melora/core": path.resolve(dirname, "../../packages/core/src"),
    },
  },
  server: {
    // Bind IPv4 explicitly — Windows can otherwise listen only on [::1], which
    // Prefer 5173 for the Spotify redirect URI; Vite may use the next open port.
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      // Proxy GetSongBPM API calls to avoid browser CORS restrictions
      "/bpm-api": {
        target: "https://api.getsongbpm.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/bpm-api/, ""),
        headers: {
          Referer: "https://melora.tiiny.site",
          Origin: "https://melora.tiiny.site",
        },
      },
    },
  },
});
