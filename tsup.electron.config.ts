import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    main: "electron/src/main.ts",
    preload: "electron/src/preload.ts",
    "claude-codex-mcp": "electron/src/bridge/claude-codex-mcp.ts",
  },
  outDir: "electron/dist",
  format: ["cjs"],
  target: "es2020",
  platform: "node",
  splitting: false,
  clean: true,
  external: [
    "electron",
    "node-pty",
    "electron-liquid-glass",
    "@anthropic-ai/claude-agent-sdk",
    "electron-updater",
    "posthog-node",
    "electron-context-menu",
  ],
  noExternal: [],
  treeshake: true,
  define: {
    __PCC_DIAGNOSTIC_BUILD__: JSON.stringify(process.env.PCC_DIAGNOSTIC_BUILD === "1"),
  },
});
