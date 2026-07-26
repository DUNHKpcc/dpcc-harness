import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

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
        manualChunks(id) {
          if (!id.includes("/node_modules/")) return undefined;
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
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
