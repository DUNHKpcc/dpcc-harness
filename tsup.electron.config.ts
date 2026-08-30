import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    main: "electron/src/main.ts",
    preload: "electron/src/preload.ts",
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
    "electron-updater",
    "electron-context-menu",
    "@earendil-works/pi-coding-agent",
    "pi-acp",
  ],
  noExternal: [],
  treeshake: true,
  define: {
    __PCC_DIAGNOSTIC_BUILD__: JSON.stringify(process.env.PCC_DIAGNOSTIC_BUILD === "1"),
  },
});
