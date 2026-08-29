import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative base so the built app runs from any static host, including a
  // subdirectory like /Melora/sidequest/ on GitHub Pages.
  base: "./",
  plugins: [react()],
  build: {
    // Publishes into the repo root next to download.html, which is what the
    // GitHub Pages site already serves — that folder IS the install link.
    outDir: "../../sidequest",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5175,
  },
});
