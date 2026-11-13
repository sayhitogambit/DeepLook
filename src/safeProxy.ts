import { createServer, request as httpRequest, type ClientRequest, type IncomingHttpHeaders, type Server } from "node:http";
import { connect as tcpConnect, type Socket } from "node:net";
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
    let upstream: ClientRequest | undefined;
    request.on("error", () => {
      upstream?.destroy();
      if (!response.destroyed) response.destroy();
    });
    response.on("error", () => upstream?.destroy());
    response.on("close", () => upstream?.destroy());
    void (async () => {
      try {
        const target = await validatePublicUrl(request.url ?? "", resolveAddresses);
        if (closed || response.destroyed) return;
        if (target.url.protocol !== "http:") throw new Error("HTTPS requires CONNECT.");
        const headers: IncomingHttpHeaders = { ...request.headers, host: target.url.host };
        delete headers["proxy-authorization"];
        delete headers["proxy-connection"];
        const upstreamRequest = httpRequest({
          host: target.address,
          port: target.port,
          method: request.method,
          path: `${target.url.pathname}${target.url.search}`,
          headers,
        }, (upstreamResponse) => {
          if (response.destroyed) { upstreamResponse.destroy(); return; }
          upstreamResponse.on("error", () => response.destroy());
          response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
          upstreamResponse.pipe(response);
        });
        upstream = upstreamRequest;
        requests.add(upstreamRequest);
        upstreamRequest.once("close", () => requests.delete(upstreamRequest));
        upstreamRequest.on("error", () => {
          if (response.destroyed) return;
          if (!response.headersSent) response.writeHead(502);
          response.end();
        });
        request.pipe(upstreamRequest);
      } catch {
        if (!response.destroyed) {
          response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
          response.end("Destination denied.");
        }
      }
    })();
  });

  server.on("connect", (request, client, head) => {
    let upstream: Socket | undefined;
    tunnels.add(client);
    const closeUpstream = () => upstream?.destroy();
    client.on("error", closeUpstream);
    client.once("close", () => {
      tunnels.delete(client);
      closeUpstream();
    });
    request.on("error", closeUpstream);
    void (async () => {
      try {
        const target = await validatePublicUrl(`https://${request.url ?? ""}`, resolveAddresses);
        if (closed || client.destroyed) return;
        if (target.port !== 443) throw new Error("Invalid CONNECT target.");
        const upstreamSocket = tcpConnect({ host: target.address, port: target.port });
        upstream = upstreamSocket;
        tunnels.add(upstreamSocket);
        upstreamSocket.once("close", () => tunnels.delete(upstreamSocket));
        upstreamSocket.setTimeout(30_000, () => upstreamSocket.destroy());
        upstreamSocket.on("error", () => {
          if (!client.destroyed) client.destroy();
        });
        upstreamSocket.once("connect", () => {
          if (client.destroyed) {
            upstreamSocket.destroy();
            return;
          }
          client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length > 0) upstreamSocket.write(head);
          client.pipe(upstreamSocket).pipe(client);
        });
      } catch {
        client.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
      }
    })();
  });
  server.on("clientError", (_error, socket) => socket.destroy());

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
