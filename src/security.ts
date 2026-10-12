import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type AddressResolver = (hostname: string) => Promise<ResolvedAddress[]>;
export type PublicTarget = { url: URL; address: string; port: number };

export const defaultAddressResolver: AddressResolver = async (hostname) =>
  lookup(hostname, { all: true, verbatim: true }) as Promise<ResolvedAddress[]>;

export class UnsafeUrlError extends Error {
  constructor() {
    super("Expected a public http(s) URL on the standard port.");
    this.name = "UnsafeUrlError";
  }
}

export async function validatePublicUrl(
  raw: string,
  resolveAddresses: AddressResolver = defaultAddressResolver,
): Promise<PublicTarget> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError();
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" || url.password !== "" || url.hostname === ""
  ) {
    throw new UnsafeUrlError();
  }
  const port = url.protocol === "https:" ? 443 : 80;
  if (url.port !== "" && Number(url.port) !== port) throw new UnsafeUrlError();

  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (
    hostname === "localhost" || hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") || hostname.endsWith(".internal") ||
    hostname.endsWith(".home.arpa")
  ) {
    throw new UnsafeUrlError();
  }

  const literalFamily = isIP(hostname);
  let addresses: ResolvedAddress[];
  try {
    addresses = literalFamily === 0
      ? await resolveAddresses(hostname)
      : [{ address: hostname, family: literalFamily as 4 | 6 }];
  } catch {
    throw new UnsafeUrlError();
  }
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new UnsafeUrlError();
  }
  return { url, address: addresses[0].address, port };
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 0 || b === 168)) return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (family === 6) {
    const first = Number.parseInt(address.split(":")[0], 16);
    return first >= 0x2000 && first <= 0x3fff;
  }
  return false;
}
