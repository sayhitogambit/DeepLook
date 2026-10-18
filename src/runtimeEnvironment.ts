const runtimeVariables = [
  "PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TMP", "TEMP",
  "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT",
  "XDG_RUNTIME_DIR", "XDG_CACHE_HOME", "LANG", "LC_ALL",
] as const;

/** Browser subprocesses need OS settings, not the API process's secrets. */
export function browserEnvironment(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of runtimeVariables) {
    if (env[name] !== undefined) result[name] = env[name];
  }
  return result;
}
