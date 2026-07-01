import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import electron from "vite-plugin-electron";
import renderer from "vite-plugin-electron-renderer";
import path from "path";

export default defineConfig({
  plugins: [
    vue(),
    electron([
      {
        entry: "electron/main.ts",
        vite: {
          build: {
            outDir: "dist-electron",

          },
        },
      },
      {
        entry: "electron/preload.ts",
        onstart(args) {
          args.reload();
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
