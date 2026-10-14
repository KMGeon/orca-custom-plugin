// Pure conversion from raw `orca orchestration` JSON into the panel's flow model:
// agents (nodes), events (who asked whom for what), tasks, and per-agent state timelines.

const TERMINAL_TASK_STATUS = new Set(['completed', 'failed'])
const TASK_STATE = { pending: 'idle', ready: 'idle', dispatched: 'working', blocked: 'blocked', completed: 'done', failed: 'failed' }
const MESSAGE_KIND = {
  question: 'ask',
  escalation: 'ask',
  decision_gate: 'ask',
  handoff: 'handoff',
  status: 'message',
  merge_ready: 'message'
}
const TITLE_MAX = 120

/** Orca mixes `YYYY-MM-DD HH:MM:SS` (UTC, no zone) with ISO strings. */
export function parseTime(value) {
  if (!value) return null
  const text = String(value)
  const iso = /^\d{4}-\d\d-\d\d \d/.test(text) ? `${text.replace(' ', 'T')}Z` : text
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

function parseJson(value, fallback) {
  if (typeof value !== 'string') return value ?? fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function clip(text, max = TITLE_MAX) {
  const line = String(text ?? '').split('\n').find((part) => part.trim()) ?? ''
  const trimmed = line.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}

/** Terminal titles carry agent spinner glyphs (◐ ✳ ⠂); keep the readable part. */
export function cleanTerminalTitle(title) {
  return String(title ?? '').replace(/^[^\p{L}\p{N}]+/u, '').trim()
}

/** `pty::/path/to/worktree@@hash:uuid` -> `worktree`; the only name hint left once a terminal closes. */
export function worktreeNameFromIncarnation(incarnation) {
  const match = /::(.+?)@@/.exec(String(incarnation ?? ''))
  return match ? match[1].split(/[\\/]/).filter(Boolean).pop() ?? '' : ''
}

function shortBranch(branch) {
  return branch ? String(branch).replace(/^refs\/heads\//, '') : ''
}

export function buildRunFlow({ run, tasks = [], dispatches = new Map(), messages = [], terminals = new Map() }) {
  const coordinator = run.coordinator_handle ?? `run:${run.id}`
  const dispatchById = new Map([...dispatches.values()].map((d) => [d.id, d]))
  const resolveHandle = (handle) => {
    if (!handle) return null
    if (handle.startsWith('dispatch:')) return dispatchById.get(handle.slice('dispatch:'.length))?.assignee_handle ?? handle
    if (handle.startsWith('run:')) return coordinator
    return handle
  }

  const worktreeHints = new Map()
  for (const dispatch of dispatches.values()) {
    const hint = worktreeNameFromIncarnation(dispatch.process_incarnation)
    if (hint && dispatch.assignee_handle) worktreeHints.set(dispatch.assignee_handle, hint)
  }

  const agents = new Map()
  const ensureAgent = (handle) => {
    if (!handle || agents.has(handle)) return
    const terminal = terminals.get(handle)
    const branch = shortBranch(terminal?.branch)
    const isCoordinator = handle === coordinator
    agents.set(handle, {
      id: handle,
      // Closed terminals lose their title; workers then take their first task's title below.
      name: cleanTerminalTitle(terminal?.title) || (isCoordinator ? '코디네이터' : ''),
      cli: terminal?.agentIdentity ?? null,
      branch: branch || worktreeHints.get(handle) || '',
      role: isCoordinator ? 'coordinator' : 'worker',
      live: Boolean(terminal),
      col: isCoordinator ? 0 : null
    })
  }
  ensureAgent(coordinator)

  const doneSubjects = new Map()
  const events = []
  for (const message of messages) {
    if (message.type === 'worker_done') {
      const taskId = parseJson(message.payload, {})?.taskId
      if (taskId && message.subject) doneSubjects.set(taskId, clip(message.subject))
      continue
    }
    const base = MESSAGE_KIND[message.type]
    if (!base) continue
    const from = resolveHandle(message.from_handle)
    const to = resolveHandle(message.to_handle)
    const t = parseTime(message.created_at)
    if (!from || !to || from === to || t === null) continue
    ensureAgent(from)
    ensureAgent(to)
    const kind = base === 'message' && message.thread_id ? 'reply' : base
    events.push({ t, kind, from, to, task: null, text: clip(message.subject || message.body) })
  }

  const taskList = []
  for (const task of [...tasks].sort((a, b) => (parseTime(a.created_at) ?? 0) - (parseTime(b.created_at) ?? 0))) {
    const creator = resolveHandle(task.created_by_terminal_handle) ?? coordinator
    const dispatch = dispatches.get(task.id)
    const owner = resolveHandle(dispatch?.assignee_handle) ?? null
    const title = clip(task.task_title || task.display_name || task.spec)
    const createdAt = parseTime(task.created_at)
    const dispatchedAt = parseTime(dispatch?.dispatched_at) ?? createdAt
    const completedAt = parseTime(task.completed_at) ?? parseTime(dispatch?.completed_at)
    const states = []
    if (createdAt !== null) states.push([createdAt, 'idle'])
    ensureAgent(creator)
    if (owner) {
      ensureAgent(owner)
      events.push({ t: dispatchedAt, kind: 'dispatch', from: creator, to: owner, task: task.id, text: title })
      states.push([dispatchedAt, 'working'])
      if (TERMINAL_TASK_STATUS.has(task.status) && completedAt !== null) {
        const failed = task.status === 'failed'
        const summary = doneSubjects.get(task.id) ?? (failed ? `실패 · ${title}` : `완료 · ${title}`)
        events.push({ t: completedAt, kind: failed ? 'failed' : 'result', from: owner, to: creator, task: task.id, text: summary })
        states.push([completedAt, failed ? 'failed' : 'done'])
      }
    }
    const finalState = TASK_STATE[task.status]
    if (TERMINAL_TASK_STATUS.has(task.status) && states.at(-1)?.[1] !== finalState) {
      states.push([completedAt ?? createdAt ?? 0, finalState])
    }
    if (task.status === 'blocked') states.push([states.at(-1)?.[0] ?? createdAt ?? 0, 'blocked'])
    taskList.push({
      id: task.id,
      title,
      owner,
      creator,
      deps: parseJson(task.deps, []),
      parent: task.parent_id ?? null,
      status: TASK_STATE[task.status] ?? 'idle',
      states
    })
  }

  events.sort((a, b) => a.t - b.t)
  for (const agent of agents.values()) {
    if (agent.name) continue
    const firstTask = taskList.find((task) => task.owner === agent.id)
    agent.name = firstTask?.title || agent.branch || `agent ${agent.id.slice(5, 11)}`
  }
  disambiguateNames(agents)
  assignColumns(agents, events)
  const runStart = parseTime(run.created_at) ?? events[0]?.t ?? 0
  const agentStates = buildAgentStates(agents, events, coordinator, runStart, taskList)

  return {
    id: run.id,
    source: 'orca',
    title: clip(run.objective) || run.id,
    columnNames: ['코디네이터', '작업자', '하위 작업자'],
    createdAt: runStart,
    updatedAt: Math.max(runStart, ...events.map((e) => e.t)),
    active: taskList.some((task) => task.status !== 'done' && task.status !== 'failed'),
    agents: [...agents.values()],
    tasks: taskList,
    events,
    agentStates
  }
}

function disambiguateNames(agents) {
  const seen = new Map()
  for (const agent of agents.values()) {
    const count = (seen.get(agent.name) ?? 0) + 1
    seen.set(agent.name, count)
    if (count > 1) agent.name = `${agent.name} #${count}`
  }
}

/** Column = delegation depth: coordinator 0, whoever it dispatches 1, their dispatches 2, ... */
function assignColumns(agents, events) {
  for (const event of events) {
    if (event.kind !== 'dispatch') continue
    const to = agents.get(event.to)
    if (to.col === null) to.col = (agents.get(event.from).col ?? 0) + 1
  }
  for (const agent of agents.values()) {
    if (agent.col === null) agent.col = 1
  }
}

function buildAgentStates(agents, events, coordinator, runStart, tasks) {
  const states = Object.fromEntries([...agents.keys()].map((id) => [id, []]))
  const active = new Map()
  const blocked = new Set()
  const push = (id, t, state) => {
    const list = states[id]
    if (list.at(-1)?.[1] !== state) list.push([t, state])
  }
  const settle = (id, t) => push(id, t, blocked.has(id) ? 'blocked' : (active.get(id) ?? 0) > 0 ? 'working' : 'done')

  push(coordinator, runStart, 'working')
  for (const event of events) {
    if (event.kind === 'dispatch') {
      active.set(event.to, (active.get(event.to) ?? 0) + 1)
      settle(event.to, event.t)
    } else if (event.kind === 'result' || event.kind === 'failed') {
      active.set(event.from, Math.max(0, (active.get(event.from) ?? 0) - 1))
      blocked.delete(event.from)
      settle(event.from, event.t)
    } else if (event.kind === 'ask') {
      blocked.add(event.from)
      settle(event.from, event.t)
    } else if (blocked.has(event.to)) {
      blocked.delete(event.to)
      settle(event.to, event.t)
    }
  }
  const allDone = tasks.length > 0 && tasks.every((task) => task.status === 'done' || task.status === 'failed')
  if (allDone) push(coordinator, Math.max(runStart, ...events.map((e) => e.t)), 'done')
  return states
}
