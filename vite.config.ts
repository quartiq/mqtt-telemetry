import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "baseline-widely-available",
  },
  plugins: [svelte()],
  server: {
    watch: { ignored: ["**/.codex/**"] },
  },
});
