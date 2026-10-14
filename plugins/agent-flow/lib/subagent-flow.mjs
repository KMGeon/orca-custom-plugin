// Pure conversion of Claude subagent records into flow nodes/events, either attached to an
// existing flow (orchestration workers) or as a standalone per-session flow.

export const SUBAGENT_LIMIT_PER_AGENT = 12
const LABEL_MAX = 80

function clip(text) {
  const line = String(text ?? '').trim().split('\n')[0]
  return line.length > LABEL_MAX ? `${line.slice(0, LABEL_MAX - 1)}…` : line
}

/**
 * @param subagents [{ id, agentType, description, depth, startedAt, endedAt, state }]
 *   state: 'working' | 'blocked' | 'done' (live hook state wins over transcript age)
 */
export function attachSubagents(flow, subagentsByAgent, { since = -Infinity } = {}) {
  const agents = new Map(flow.agents.map((agent) => [agent.id, agent]))
  for (const [parentId, list] of subagentsByAgent) {
    const parent = agents.get(parentId)
    if (!parent) continue
    const relevant = list
      .filter((sub) => sub.startedAt >= since)
      .sort((a, b) => a.startedAt - b.startedAt)
      .slice(-SUBAGENT_LIMIT_PER_AGENT)
    for (const sub of relevant) {
      const id = `${parentId}::sub:${sub.id}`
      const name = clip(sub.description) || sub.agentType || 'subagent'
      const node = {
        id,
        name,
        cli: sub.agentType ?? 'subagent',
        branch: '',
        role: 'subagent',
        parent: parentId,
        live: sub.state !== 'done',
        col: parent.col + Math.max(1, sub.depth ?? 1)
      }
      flow.agents.push(node)
      agents.set(id, node)
      flow.events.push({ t: sub.startedAt, kind: 'spawn', from: parentId, to: id, task: null, text: name })
      const states = [[sub.startedAt, 'working']]
      if (sub.state === 'done' && sub.endedAt) {
        flow.events.push({ t: sub.endedAt, kind: 'result', from: id, to: parentId, task: null, text: `완료 · ${name}` })
        states.push([sub.endedAt, 'done'])
      } else if (sub.state === 'blocked') {
        states.push([sub.endedAt ?? sub.startedAt, 'blocked'])
      }
      flow.agentStates[id] = states
    }
  }
  flow.events.sort((a, b) => a.t - b.t)
  const times = flow.events.map((event) => event.t)
  flow.updatedAt = Math.max(flow.updatedAt, ...times)
  flow.active ||= flow.agents.some((agent) => agent.role === 'subagent' && agent.live)
  return flow
}

/** One Claude session (a terminal) and the subagents it spawned, for work outside orchestration. */
export function buildSessionFlow({ paneKey, terminal, mainState, subagents }) {
  const id = terminal?.handle ?? paneKey
  const name = String(terminal?.title ?? '').replace(/^[^\p{L}\p{N}]+/u, '').trim() || 'Claude 세션'
  const branch = terminal?.branch ? String(terminal.branch).replace(/^refs\/heads\//, '') : ''
  const start = Math.min(...subagents.map((sub) => sub.startedAt))
  const flow = {
    id: `session:${paneKey}`,
    source: 'session',
    title: `${name}${branch ? ` · ${branch}` : ''}`,
    columnNames: ['메인 에이전트', '서브에이전트', '하위 서브에이전트'],
    createdAt: start,
    updatedAt: start,
    active: mainState === 'working',
    agents: [{ id, name, cli: terminal?.agentIdentity ?? 'claude', branch, role: 'coordinator', live: Boolean(terminal), col: 0 }],
    tasks: [],
    events: [],
    agentStates: { [id]: [[start, 'working']] }
  }
  attachSubagents(flow, new Map([[id, subagents]]))
  if (mainState !== 'working' && mainState !== 'blocked') flow.agentStates[id].push([flow.updatedAt, 'done'])
  if (mainState === 'blocked') flow.agentStates[id].push([flow.updatedAt, 'blocked'])
  return flow
}
