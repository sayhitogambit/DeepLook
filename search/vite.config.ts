import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Connect } from "vite";
import { defineConfig } from "vite";
import { runQuery } from "./server/query";
import { attachService } from "./server/service";

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "deeplook-query",
      configureServer(server) {
        attachService(server);
        server.middlewares.use(async (req, res, next) => {
          if (req.url !== "/api/query" || req.method !== "POST") {
            next();
            return;
          }
          res.setHeader("content-type", "text/event-stream");
          res.setHeader("cache-control", "no-cache");
          res.setHeader("connection", "keep-alive");
          const send = (event: string, data: unknown) => {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          };
          try {
            const raw = await readBody(req);
            const body = JSON.parse(raw) as { query?: string };
            const query = body.query?.trim() ?? "";
            if (!query) {
              send("error", { message: "Enter a question first." });
              res.end();
              return;
            }
            await runQuery(query, send);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Query failed.";
            send("error", { message });
          }
          res.end();
        });
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    port: 47241,
    strictPort: true,
  },
});
