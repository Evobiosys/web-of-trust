import { defineConfig } from "vitest/config";

export default defineConfig({
  server: { port: 8080 },
  preview: { port: 8080 },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
