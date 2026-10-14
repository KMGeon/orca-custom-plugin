import { execFile } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'

const CLI_TIMEOUT_MS = 15_000
const CLI_MAX_BUFFER = 32 * 1024 * 1024

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Candidate `orca` CLI paths: explicit override, the app bundle that runs this worker, then PATH. */
export function orcaCliCandidates({ override, execPath = process.execPath, env = process.env, platform = process.platform } = {}) {
  const name = platform === 'win32' ? 'orca.cmd' : 'orca'
  const candidates = []
  if (override) candidates.push(override)
  // The worker runs on Orca's own Electron binary (ELECTRON_RUN_AS_NODE), so the bundled CLI sits beside it.
  if (platform === 'darwin') candidates.push(join(dirname(execPath), '..', 'Resources', 'bin', name))
  else candidates.push(join(dirname(execPath), 'resources', 'bin', name))
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (dir) candidates.push(join(dir, name))
  }
  if (platform === 'darwin') candidates.push('/Applications/Orca.app/Contents/Resources/bin/orca')
  return candidates
}

export function resolveOrcaCli(options) {
  return orcaCliCandidates(options).find(isExecutable) ?? null
}

export class OrcaCliError extends Error {
  constructor(message, code) {
    super(message)
    this.code = code
  }
}

/** Runs `orca <args> --json` and returns `result`, or throws OrcaCliError. */
export function runOrcaJson(cliPath, args) {
  return new Promise((resolve, reject) => {
    execFile(
      cliPath,
      [...args, '--json'],
      { timeout: CLI_TIMEOUT_MS, maxBuffer: CLI_MAX_BUFFER, windowsHide: true },
      (error, stdout) => {
        let parsed = null
        try {
          parsed = JSON.parse(stdout)
        } catch {
          // Fall through: a non-JSON stdout means the CLI itself failed.
        }
        if (parsed?.ok) return resolve(parsed.result)
        const code = parsed?.error?.code ?? (error ? 'exec_failed' : 'bad_output')
        reject(new OrcaCliError(parsed?.error?.message ?? error?.message ?? 'orca CLI returned no JSON', code))
      }
    )
  })
}
