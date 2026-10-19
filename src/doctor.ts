import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { resolveChromeExecutable } from "./profile.js";
import { browserEnvironment } from "./runtimeEnvironment.js";
import { probeRemoteHealth, remoteConfiguration, RemoteApiError } from "./remoteApi.js";

const execute = promisify(execFile);

export type DiagnosticReport = {
  ok: boolean;
  mode: "local" | "remote";
  checks: Array<{ name: "browser" | "api"; ok: boolean; message: string; version?: string }>;
};

export async function diagnose(): Promise<DiagnosticReport> {
  try {
    const configuration = remoteConfiguration();
    if (configuration) {
      await probeRemoteHealth(configuration);
      return { ok: true, mode: "remote", checks: [{ name: "api", ok: true,
        message: "API health endpoint responds. Browser execution and key permissions are not checked." }] };
    }
  } catch (cause) {
    return { ok: false, mode: "remote", checks: [{ name: "api", ok: false,
      message: cause instanceof RemoteApiError ? cause.message : "The API health endpoint could not be reached." }] };
  }
  try {
    const executable = await resolveChromeExecutable();
    const { stdout } = await execute(executable, ["--version"], {
      timeout: 3_000, maxBuffer: 8_192, env: browserEnvironment(), encoding: "utf8",
    });
    const version = stdout.trim();
    if (!/^(?:Google Chrome(?: for Testing)?|Chromium)\s+\d/.test(version)) {
      throw new Error("The executable is not Chrome or Chromium.");
    }
    return { ok: true, mode: "local", checks: [{ name: "browser", ok: true, message: "Browser executable responds.", version }] };
  } catch {
    return { ok: false, mode: "local", checks: [{ name: "browser", ok: false,
      message: "Chrome could not be probed. Install Chrome or set DEEPLOOK_CHROME to a working executable." }] };
  }
}
