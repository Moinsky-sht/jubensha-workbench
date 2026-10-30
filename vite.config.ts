import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
export default defineConfig({
  plugins: [vue()],
  build: { chunkSizeWarningLimit: 1100 },
  server: { host: "127.0.0.1" },
});
