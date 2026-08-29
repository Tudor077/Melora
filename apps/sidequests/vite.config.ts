import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative base so the built app runs from any static host or a file:// share.
  base: "./",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5175,
  },
});
