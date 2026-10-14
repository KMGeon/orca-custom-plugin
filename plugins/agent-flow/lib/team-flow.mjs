// Pure conversion of a Claude agent team (~/.claude/teams/<team>) into the panel's flow model.

const LABEL_MAX = 120
const TASK_STATE = { pending: 'idle', in_progress: 'working', completed: 'done', blocked: 'blocked' }

function clip(text) {
  const line = String(text ?? '').split('\n').find((part) => part.trim())?.trim() ?? ''
  return line.length > LABEL_MAX ? `${line.slice(0, LABEL_MAX - 1)}…` : line
}

function time(value) {
  const ms = typeof value === 'number' ? value : Date.parse(value ?? '')
  return Number.isFinite(ms) ? ms : null
}

/**
 * @param team { name, config, inboxes: Map<recipient, message[]>, tasks: object[], active: boolean }
 */
export function buildTeamFlow({ name, config, inboxes = new Map(), tasks = [], active = false }) {
  const members = config.members ?? []
  const leadName = members.find((member) => member.agentId === config.leadAgentId)?.name ?? members[0]?.name ?? 'team-lead'
  const idOf = (member) => `team:${name}:${member}`
  const lead = idOf(leadName)
  const createdAt = time(config.createdAt) ?? 0

  const agents = members.map((member) => ({
    id: idOf(member.name),
    name: member.name,
    cli: member.model ? `${member.agentType ?? 'agent'} · ${member.model}` : member.agentType ?? 'agent',
    branch: '',
    role: member.name === leadName ? 'coordinator' : 'worker',
    live: active,
    col: member.name === leadName ? 0 : 1
  }))
  const known = new Set(agents.map((agent) => agent.id))
  const ensure = (member) => {
    const id = idOf(member)
    if (!known.has(id)) {
      known.add(id)
      agents.push({ id, name: member, cli: 'agent', branch: '', role: 'worker', live: active, col: 1 })
    }
    return id
  }

  const events = []
  for (const member of members) {
    if (member.name === leadName) continue
    const joinedAt = time(member.joinedAt)
    if (joinedAt !== null) {
      events.push({ t: joinedAt, kind: 'spawn', from: lead, to: idOf(member.name), task: null, text: `합류 · ${member.agentType ?? 'agent'}` })
    }
  }
  const briefed = new Set()
  for (const [recipient, messages] of inboxes) {
    const to = ensure(recipient)
    for (const message of messages) {
      const t = time(message.timestamp)
      if (t === null || !message.from) continue
      const from = ensure(message.from)
      if (from === to) continue
      // The lead's first message to a teammate is its assignment.
      const kind = from === lead && !briefed.has(to) ? 'dispatch' : 'message'
      if (kind === 'dispatch') briefed.add(to)
      events.push({ t, kind, from, to, task: null, text: clip(message.text) })
    }
  }
  events.sort((a, b) => a.t - b.t)

  const taskList = tasks.map((task) => {
    const status = TASK_STATE[task.status] ?? 'idle'
    const owner = task.owner ? ensure(task.owner) : null
    return {
      id: String(task.id ?? ''),
      title: clip(task.subject ?? task.title ?? task.description) || String(task.id ?? ''),
      owner,
      creator: lead,
      deps: Array.isArray(task.blockedBy) ? task.blockedBy : [],
      parent: null,
      status,
      states: [[createdAt, status]]
    }
  })

  const updatedAt = Math.max(createdAt, ...events.map((event) => event.t))
  const agentStates = {}
  for (const agent of agents) {
    const joined = events.find((event) => event.to === agent.id && event.kind === 'spawn')?.t ?? createdAt
    agentStates[agent.id] = active ? [[joined, 'working']] : [[joined, 'working'], [updatedAt, 'done']]
  }

  return {
    id: `team:${name}`,
    source: 'claude-team',
    title: clip(config.description) || name,
    columnNames: ['팀 리더', '팀원', '하위'],
    createdAt,
    updatedAt,
    active,
    agents,
    tasks: taskList,
    events,
    agentStates
  }
}
