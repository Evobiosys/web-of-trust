import { defineConfig } from "vitest/config";

export default defineConfig({
  server: { port: 5175 },
  preview: { port: 5175 },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.js"],
  },
});
