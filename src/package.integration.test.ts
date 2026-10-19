import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { browserEnvironment } from "./runtimeEnvironment.js";

const execute = promisify(execFile);

// Exercises the artifact a user installs: a fresh source copy has no dist,
// packing must build it, and installation has no development dependencies.
test("tarball builds from source and installs an independent CLI and MCP", {
  skip: process.env.DEEPLOOK_TEST_PACKAGE !== "1", timeout: 120_000,
}, async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), "deeplook-package-"));
  const source = join(directory, "source");
  const destination = join(directory, "consumer");
  const npmCli = process.env.npm_execpath;
  assert.ok(npmCli, "run package integration through npm so its CLI path is available");
  const env = { ...browserEnvironment(), DEEPLOOK_CHROME: "/deeplook-test/no-chrome" };
  const npm = (args: string[], cwd: string) => execute(process.execPath, [npmCli, ...args], {
    cwd, env, timeout: 60_000, killSignal: "SIGKILL", maxBuffer: 2_000_000,
  });
  try {
    await mkdir(source); await mkdir(destination);
    for (const file of ["package.json", "package-lock.json", "tsconfig.json", "README.md", "src"]) {
      await cp(join(root, file), join(source, file), { recursive: true });
    }
    await symlink(join(root, "node_modules"), join(source, "node_modules"), "junction");
    const packed = JSON.parse((await npm(["pack", "--json", "--pack-destination", directory], source)).stdout)[0] as {
      filename: string; files: Array<{ path: string }>;
    };
    const paths = packed.files.map((file) => file.path);
    assert.ok(paths.includes("dist/cli.js"), "pack must compile the CLI from a source tree without dist");
    assert.ok(paths.includes("dist/mcp.js"));
    assert.ok(paths.includes("README.md"));
    assert.ok(paths.every((path) => path === "package.json" || path === "README.md" ||
      (path.startsWith("dist/") && path.endsWith(".js") && !path.endsWith(".test.js"))),
    `tarball must contain runtime files only: ${JSON.stringify(paths)}`);
    await npm(["install", "--offline", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund",
      join(directory, packed.filename)], destination);
    const installed = join(destination, "node_modules", "deeplook");
    const manifest = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
    const binary = join(installed, manifest.bin.deeplook);
    const executable = join(destination, "node_modules", ".bin", process.platform === "win32" ? "deeplook.cmd" : "deeplook");
    await access(executable);
    await assert.rejects(access(join(destination, "node_modules", "typescript")));
    await assert.rejects(access(join(destination, "node_modules", "@modelcontextprotocol", "client")));
    const version = await execute(process.platform === "win32" ? process.execPath : executable,
      process.platform === "win32" ? [binary, "--version"] : ["--version"], { cwd: dirname(destination), env });
    assert.equal(version.stdout, `${manifest.version}\n`);
    assert.equal(version.stderr, "");
    const doctor = await execute(process.execPath, [binary, "doctor", "--json"], { env }).then(
      () => { throw new Error("doctor must fail with no browser configured"); },
      (error: { code: number; stdout: string; stderr: string }) => error);
    assert.equal(doctor.code, 1);
    assert.equal(JSON.parse(doctor.stdout).mode, "local");
    assert.equal(JSON.parse(doctor.stdout).ok, false);
    assert.equal(doctor.stderr, "");
    const client = new Client({ name: "package-test", version: "1.0.0" });
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [binary, "mcp"], env }), { timeout: 5_000 });
      assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name), ["deeplook_open"]);
      assert.deepEqual(client.getServerVersion(), { name: "deeplook", version: manifest.version });
    } finally { await client.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
