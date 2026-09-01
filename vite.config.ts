import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, loadEnv } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig(({ command, mode }) => {
  const environment = loadEnv(mode, ".", "");
  const buildCommit =
    environment.MQTT_TELEMETRY_BUILD_COMMIT ||
    environment.GITHUB_SHA ||
    "local";
  return {
    base: "./",
    build: {
      modulePreload: { polyfill: false },
      target: "baseline-widely-available",
    },
    define: { __BUILD_COMMIT__: JSON.stringify(buildCommit) },
    plugins: [svelte(), ...(command === "build" ? [viteSingleFile()] : [])],
  };
});
