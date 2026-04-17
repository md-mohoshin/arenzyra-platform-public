import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const devPort = Number(process.env.DEV_SERVER_PORT || 5400);

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    port: devPort,
    strictPort: true,
  },
  build: {
    outDir: "dist",
  },
});
