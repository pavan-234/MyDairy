import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": "https://mydiary-backend-k782.onrender.com"
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.js",
    clearMocks: true,
    coverage: {
      include: ["src/api/auth.js", "src/components/AuthPage.jsx"]
    }
  }
});
