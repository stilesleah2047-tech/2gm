import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the dashboard runs on 5173 and proxies to the API on 4000,
// so the browser sees one origin and needs no CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
      "/uploads": "http://localhost:4000",
    },
  },
});
