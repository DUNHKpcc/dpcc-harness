import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export function manualChunks(id: string): string | undefined {
  // Keep Vite's preload helper out of large lazy chunks. Rollup may otherwise
  // place it in vendor-mermaid and turn that async chunk into a startup import.
  if (id.includes("vite/preload-helper")) return "vendor-runtime";
  if (!id.includes("/node_modules/")) return undefined;
  if (id.includes("/dompurify/")) return "vendor-sanitizer";
  if (id.includes("/@huggingface/transformers/")) return "vendor-transformers";
  if (id.includes("/monaco-editor/") || id.includes("/@monaco-editor/")) {
    return "vendor-monaco";
  }
  if (id.includes("/mermaid/") || id.includes("/@mermaid-js/")) return "vendor-mermaid";
  if (id.includes("/react-konva/") || id.includes("/konva/")) return "vendor-konva";
  if (
    id.includes("/react/")
    || id.includes("/react-dom/")
    || id.includes("/scheduler/")
    || id.includes("/use-sync-external-store/")
    || id.includes("/zustand/")
    || id.includes("/@tanstack/react-virtual/")
  ) {
    return "vendor-react";
  }
  if (
    id.includes("/radix-ui/")
    || id.includes("/@radix-ui/")
    || id.includes("/lucide-react/")
    || id.includes("/sonner/")
  ) {
    return "vendor-ui";
  }
  if (id.includes("/motion/") || id.includes("/framer-motion/")) return "vendor-motion";
  if (
    id.includes("/react-syntax-highlighter/")
    || id.includes("/refractor/")
    || id.includes("/prismjs/")
  ) {
    return "vendor-syntax";
  }
  if (id.includes("/i18next/") || id.includes("/react-i18next/")) return "vendor-i18n";
  if (id.includes("/react-markdown/") || id.includes("/remark-gfm/")) {
    return "vendor-markdown";
  }
  if (id.includes("/@xterm/")) return "vendor-xterm";
  return undefined;
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  server: {
    port: 5173,
  },
});
