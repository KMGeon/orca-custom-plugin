// Readers for data that lives on this desktop: Orca's hook-status file (live subagents),
// Claude transcripts (subagent history), and Claude agent-team folders.
import { open, readdir, readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'

const EDGE_BYTES = 8 * 1024
const TEAM_ACTIVE_MS = 10 * 60_000

export function orcaUserDataDir({ home = process.env.HOME ?? process.env.USERPROFILE ?? '', platform = process.platform } = {}) {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'orca')
  if (platform === 'win32') return join(home, 'AppData', 'Roaming', 'orca')
  return join(home, '.config', 'orca')
}

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return fallback
  }
}

/**
 * Orca's hook server persists its last agent status per pane here. This is an Orca-internal file,
 * so every field is optional and a format change degrades to "no subagents" instead of failing.
 */
export async function readHookStatus(userDataDir) {
  const data = await readJson(join(userDataDir, 'agent-hooks', 'last-status.json'), {})
  const panes = new Map()
  for (const entry of Object.values(data?.entries ?? {})) {
    if (!entry?.paneKey) continue
    panes.set(entry.paneKey, {
      source: entry.source ?? null,
      mainState: entry.payload?.state ?? null,
      liveSubagents: Array.isArray(entry.payload?.subagents) ? entry.payload.subagents : [],
      transcriptPath: entry.providerSession?.transcriptPath ?? null
    })
  }
  return panes
}

function timestampOf(line) {
  try {
    const ms = Date.parse(JSON.parse(line).timestamp)
    return Number.isFinite(ms) ? ms : null
  } catch {
    return null
  }
}

/** First and last JSONL timestamps without reading the whole transcript. */
async function transcriptSpan(path) {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    const head = Buffer.alloc(Math.min(EDGE_BYTES, size))
    await handle.read(head, 0, head.length, 0)
    const tail = Buffer.alloc(Math.min(EDGE_BYTES, size))
    await handle.read(tail, 0, tail.length, size - tail.length)
    const first = head.toString('utf8').split('\n').map(timestampOf).find((t) => t !== null) ?? null
    const lastLines = tail.toString('utf8').split('\n').map(timestampOf).filter((t) => t !== null)
    return { startedAt: first, lastAt: lastLines.at(-1) ?? first }
  } finally {
    await handle.close()
  }
}

export class SubagentReader {
  constructor() {
    this.spanCache = new Map()
  }

  /** Subagents of one Claude session: transcript history merged with the hook's live list. */
  async read(pane) {
    const byId = new Map()
    if (pane.transcriptPath) {
      const dir = join(pane.transcriptPath.replace(/\.jsonl$/, ''), 'subagents')
      let files = []
      try {
        files = await readdir(dir)
      } catch {
        // No subagents directory: the session never spawned one.
      }
      for (const file of files.filter((name) => name.endsWith('.meta.json'))) {
        const id = basename(file, '.meta.json').replace(/^agent-/, '')
        const meta = await readJson(join(dir, file), {})
        const span = await this.span(join(dir, `agent-${id}.jsonl`))
        if (!span?.startedAt) continue
        byId.set(id, {
          id,
          agentType: meta.agentType ?? null,
          description: meta.description ?? '',
          depth: meta.spawnDepth ?? 1,
          startedAt: span.startedAt,
          endedAt: span.lastAt,
          state: 'done'
        })
      }
    }
    for (const live of pane.liveSubagents) {
      const known = byId.get(live.id)
      const state = live.state === 'blocked' || live.state === 'waiting' ? 'blocked' : 'working'
      byId.set(live.id, {
        id: live.id,
        agentType: live.agentType ?? known?.agentType ?? null,
        description: live.description ?? known?.description ?? '',
        depth: known?.depth ?? 1,
        startedAt: known?.startedAt ?? live.startedAt,
        endedAt: null,
        state
      })
    }
    return [...byId.values()]
  }

  async span(path) {
    try {
      const { mtimeMs, size } = await stat(path)
      const key = `${mtimeMs}:${size}`
      const cached = this.spanCache.get(path)
      if (cached?.key === key) return cached.span
      const span = await transcriptSpan(path)
      this.spanCache.set(path, { key, span })
      return span
    } catch {
      return null
    }
  }
}

/** Most recently touched Claude agent teams with at least one teammate. */
export async function readClaudeTeams(home, { limit = 4, maxAgeMs = 3 * 24 * 60 * 60_000, now = Date.now() } = {}) {
  const teamsDir = join(home, '.claude', 'teams')
  let names = []
  try {
    names = await readdir(teamsDir)
  } catch {
    return []
  }
  const candidates = []
  for (const name of names) {
    const dir = join(teamsDir, name)
    const touched = await latestMtime([join(dir, 'config.json'), join(dir, 'inboxes')])
    if (touched !== null && now - touched <= maxAgeMs) candidates.push({ name, dir, touched })
  }
  candidates.sort((a, b) => b.touched - a.touched)

  const teams = []
  for (const candidate of candidates) {
    if (teams.length >= limit) break
    const config = await readJson(join(candidate.dir, 'config.json'))
    if (!config || (config.members ?? []).length < 2) continue
    const inboxes = new Map()
    const inboxDir = join(candidate.dir, 'inboxes')
    for (const file of await readdir(inboxDir).catch(() => [])) {
      if (!file.endsWith('.json')) continue
      const messages = await readJson(join(inboxDir, file), [])
      if (Array.isArray(messages)) inboxes.set(basename(file, '.json'), messages)
    }
    const tasks = []
    const tasksDir = join(home, '.claude', 'tasks', candidate.name)
    for (const file of await readdir(tasksDir).catch(() => [])) {
      if (!file.endsWith('.json')) continue
      const task = await readJson(join(tasksDir, file))
      if (task && typeof task === 'object') tasks.push(task)
    }
    teams.push({ name: candidate.name, config, inboxes, tasks, active: now - candidate.touched < TEAM_ACTIVE_MS })
  }
  return teams
}

async function latestMtime(paths) {
  let latest = null
  for (const path of paths) {
    try {
      const { mtimeMs } = await stat(path)
      latest = Math.max(latest ?? 0, mtimeMs)
    } catch {
      // Missing path does not count.
    }
  }
  return latest
}
