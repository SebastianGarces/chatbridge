import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || "/",
  server: {
    port: 5175,
    // Allow iframe embedding from any origin (needed for Chatbox Electron)
    headers: {
      "X-Frame-Options": "ALLOWALL",
    },
  },
});
