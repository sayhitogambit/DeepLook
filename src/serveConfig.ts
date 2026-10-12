export type ServeConfig = {
  host: string;
  port: number;
  authorizationToken: string | undefined;
};

export function readServeConfig(env: NodeJS.ProcessEnv): ServeConfig {
  const host = env.DEEPLOOK_HOST || "127.0.0.1";
  const rawPort = env.DEEPLOOK_PORT;
  const port = rawPort === undefined || rawPort === "" ? 47_231 : Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("DEEPLOOK_PORT must be an integer from 1 to 65535.");
  }
  const authorizationToken = env.DEEPLOOK_API_TOKEN || undefined;
  if (host !== "127.0.0.1" && host !== "::1" && authorizationToken === undefined) {
    throw new Error("DEEPLOOK_API_TOKEN is required when DEEPLOOK_HOST is not loopback.");
  }
  return { host, port, authorizationToken };
}
