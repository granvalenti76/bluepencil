import { defineConfig } from "vite";

const serverPort = Number(process.env.DESK_PORT ?? 4317);
const webPort = Number(process.env.DESK_WEB_PORT ?? 5173);

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: webPort,
    strictPort: true,
    // changeOrigin: the server checks Host and Origin and wants those of its own address.
    proxy: { "/api": { target: `http://127.0.0.1:${serverPort}`, changeOrigin: true } },
  },
});
