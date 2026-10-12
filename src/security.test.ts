import assert from "node:assert/strict";
import { request } from "node:http";
import test from "node:test";

import { startSafeProxy } from "./safeProxy.js";
import { validatePublicUrl, type AddressResolver } from "./security.js";

const publicResolver: AddressResolver = async () => [{ address: "93.184.216.34", family: 4 }];

test("URL validation rejects local, link-local, metadata, and userinfo targets", async () => {
  for (const url of [
    "http://127.0.0.1/admin",
    "http://2130706433/admin",
    "http://[::1]/",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.1/",
    "http://192.168.1.1/",
    "http://localhost/",
    "http://user:pass@example.com/",
    "https://example.com:8443/",
  ]) {
    await assert.rejects(validatePublicUrl(url, publicResolver), /public http\(s\) URL/i, url);
  }
});

test("URL validation rejects a hostname with any private DNS answer", async () => {
  const mixedResolver: AddressResolver = async () => [
    { address: "93.184.216.34", family: 4 },
    { address: "10.0.0.5", family: 4 },
  ];
  await assert.rejects(validatePublicUrl("https://rebind.example/", mixedResolver), /public http\(s\) URL/i);
});

test("URL validation pins a public DNS answer", async () => {
  const target = await validatePublicUrl("https://example.com/path?q=1", publicResolver);
  assert.equal(target.url.href, "https://example.com/path?q=1");
  assert.equal(target.address, "93.184.216.34");
  assert.equal(target.port, 443);
});

test("browser proxy rejects a redirected private HTTP destination", async () => {
  const proxy = await startSafeProxy(publicResolver);
  try {
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const requestToProxy = request(proxy.url, {
        method: "GET",
        path: "http://169.254.169.254/latest/meta-data/",
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
        }));
      });
      requestToProxy.on("error", reject);
      requestToProxy.end();
    });
    assert.equal(response.status, 403);
    assert.equal(response.body.includes("meta-data"), false);
  } finally {
    await proxy.close();
  }
});

test("browser proxy rejects a private HTTPS tunnel", async () => {
  const proxy = await startSafeProxy(publicResolver);
  try {
    const result = await new Promise<number>((resolve, reject) => {
      const connectRequest = request(proxy.url, {
        method: "CONNECT", path: "169.254.169.254:443",
      });
      connectRequest.on("connect", (response, socket) => {
        socket.destroy();
        resolve(response.statusCode ?? 0);
      });
      connectRequest.on("error", reject);
      connectRequest.end();
    });
    assert.equal(result, 403);
  } finally {
    await proxy.close();
  }
});
