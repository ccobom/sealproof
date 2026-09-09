import { defineConfig } from "vite";

export default defineConfig({
  root: "src/browser-spike",
  build: {
    outDir: "../../dist/browser-spike",
    emptyOutDir: true,
  },
});
