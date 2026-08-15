import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "baseline-widely-available",
  },
  plugins: [svelte()],
  server: {
    allowedHosts: true,
  },
});
