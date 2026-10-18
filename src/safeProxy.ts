import { createServer, request as httpRequest, type ClientRequest, type IncomingHttpHeaders, type Server } from "node:http";
import { connect as tcpConnect } from "node:net";
import type { Duplex } from "node:stream";

import {
  defaultAddressResolver,
  validatePublicUrl,
  type AddressResolver,
} from "./security.js";

export type SafeProxy = { url: string; close: () => Promise<void> };

/** All browser HTTP and HTTPS connections pass through this proxy. Each
 * connection resolves its destination once and connects to that checked IP. */
export async function startSafeProxy(
  resolveAddresses: AddressResolver = defaultAddressResolver,
): Promise<SafeProxy> {
  const tunnels = new Set<Duplex>();
  const requests = new Set<ClientRequest>();
  let closed = false;
  const server: Server = createServer((request, response) => {
    void (async () => {
      try {
        const target = await validatePublicUrl(request.url ?? "", resolveAddresses);
        if (closed || response.destroyed) return;
        if (target.url.protocol !== "http:") throw new Error("HTTPS requires CONNECT.");
        const headers: IncomingHttpHeaders = { ...request.headers, host: target.url.host };
        delete headers["proxy-authorization"];
        delete headers["proxy-connection"];
        const upstream = httpRequest({
          host: target.address,
          port: target.port,
          method: request.method,
          path: `${target.url.pathname}${target.url.search}`,
          headers,
        }, (upstreamResponse) => {
          if (response.destroyed) { upstreamResponse.destroy(); return; }
          response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
          upstreamResponse.pipe(response);
        });
        requests.add(upstream);
        upstream.once("close", () => requests.delete(upstream));
        upstream.on("error", () => {
          if (!response.headersSent) response.writeHead(502);
          response.end();
        });
        response.on("close", () => upstream.destroy());
        request.pipe(upstream);
      } catch {
        if (!response.destroyed) {
          response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
          response.end("Destination denied.");
        }
      }
    })();
  });

  server.on("connect", (request, client, head) => {
    tunnels.add(client);
    client.once("close", () => tunnels.delete(client));
    void (async () => {
      try {
        const target = await validatePublicUrl(`https://${request.url ?? ""}`, resolveAddresses);
        if (closed || client.destroyed) return;
        if (target.port !== 443) throw new Error("Invalid CONNECT target.");
        const upstream = tcpConnect({ host: target.address, port: target.port });
        tunnels.add(upstream);
        upstream.once("close", () => tunnels.delete(upstream));
        upstream.setTimeout(30_000, () => upstream.destroy());
        client.once("close", () => upstream.destroy());
        client.on("error", () => upstream.destroy());
        upstream.on("error", () => {
          if (!client.destroyed) client.destroy();
        });
        upstream.once("connect", () => {
          if (client.destroyed) {
            upstream.destroy();
            return;
          }
          client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length > 0) upstream.write(head);
          client.pipe(upstream).pipe(client);
        });
      } catch {
        client.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Safe proxy did not bind.");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      closed = true;
      for (const request of requests) request.destroy();
      for (const socket of tunnels) socket.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}
