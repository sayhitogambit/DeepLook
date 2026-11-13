import type { ServerResponse } from "node:http";
import type { Connect, ViteDevServer } from "vite";
import { createNymetricPackage } from "./nymetric";

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(data));
}

export function attachService(server: ViteDevServer) {
  server.middlewares.use(async (req, res, next) => {
    const url = req.url?.split("?")[0];
    if (url !== "/api/service" && url !== "/api/service/run") {
      next();
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { message: "Use POST." });
      return;
    }
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw) as { service?: string };
      if (url === "/api/service/run") {
        sendJson(res, 404, { message: "Nymetric has no public API, so it has no tools." });
        return;
      }
      const service = body.service?.trim().toLowerCase() ?? "";
      if (!service) {
        sendJson(res, 400, { message: "Name a service." });
        return;
      }
      if (service !== "nymetric") {
        sendJson(res, 404, { message: "Nymetric is the only service that can be built from here." });
        return;
      }
      sendJson(res, 200, createNymetricPackage());
    } catch (error) {
      const message = error instanceof Error ? error.message : "The service request failed.";
      sendJson(res, 400, { message });
    }
  });
}
