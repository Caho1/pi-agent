import { resolve } from "node:path";

import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const rightCodesKey = env.OPENAI_API_KEY;

  if (!rightCodesKey) {
    console.warn("[pi-web-ui] OPENAI_API_KEY is missing. The web frontend proxy will return 401 until you add it to .env.");
  }

  return {
    root: resolve(__dirname, "web"),
    server: {
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
      cors: true,
      allowedHosts: true,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "*"
      },
      fs: {
        allow: [resolve(__dirname)]
      },
      proxy: {
        "/api/right-codes": {
          target: "https://right.codes",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/right-codes/, "/codex/v1"),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              if (rightCodesKey) {
                proxyReq.setHeader("Authorization", `Bearer ${rightCodesKey}`);
              }
            });
          }
        }
      }
    },
    build: {
      outDir: resolve(__dirname, "dist", "web"),
      emptyOutDir: true
    }
  };
});
