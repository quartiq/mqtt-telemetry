import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig(({ command }) => ({
  base: "./",
  build: {
    modulePreload: { polyfill: false },
    target: "baseline-widely-available",
  },
  plugins: [svelte(), ...(command === "build" ? [viteSingleFile()] : [])],
  server: {
    watch: { ignored: ["**/.codex/**"] },
  },
}));
