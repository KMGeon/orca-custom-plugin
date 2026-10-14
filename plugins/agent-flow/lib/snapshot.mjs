import { SubagentReader, orcaUserDataDir, readClaudeTeams, readHookStatus } from './local-sources.mjs'
import { attachSubagents, buildSessionFlow } from './subagent-flow.mjs'
import { buildTeamFlow } from './team-flow.mjs'

const SESSION_LIMIT = 4
const SESSION_MAX_AGE_MS = 24 * 60 * 60_000

/** Collects every source the panel draws. A failing source becomes a warning, not an empty panel. */
export class FlowCollector {
  constructor({ orcaSnapshotter, home = process.env.HOME ?? process.env.USERPROFILE ?? '', userDataDir = orcaUserDataDir() }) {
    this.orcaSnapshotter = orcaSnapshotter
    this.home = home
    this.userDataDir = userDataDir
    this.subagents = new SubagentReader()
  }

  async collect(now = Date.now()) {
    const warnings = []
    const attempt = async (label, fn, fallback) => {
      try {
        return await fn()
      } catch (error) {
        warnings.push(`${label}: ${error?.message ?? error}`)
        return fallback
      }
    }

    const { flows: orcaFlows, terminals } = await attempt('Orca 오케스트레이션', () => this.orcaSnapshotter.snapshot(), {
      flows: [],
      terminals: []
    })
    const panes = await attempt('에이전트 상태', () => readHookStatus(this.userDataDir), new Map())
    const paneOf = new Map(terminals.map((terminal) => [terminal.handle, `${terminal.tabId}:${terminal.leafId}`]))

    const usedPanes = new Set()
    for (const flow of orcaFlows) {
      const byAgent = new Map()
      for (const agent of flow.agents) {
        const paneKey = paneOf.get(agent.id)
        const pane = paneKey && panes.get(paneKey)
        if (!pane) continue
        usedPanes.add(paneKey)
        const subs = await this.subagents.read(pane)
        if (subs.length) byAgent.set(agent.id, subs)
      }
      attachSubagents(flow, byAgent, { since: flow.createdAt })
    }

    const terminalByPane = new Map(terminals.map((terminal) => [`${terminal.tabId}:${terminal.leafId}`, terminal]))
    const sessionFlows = []
    for (const [paneKey, pane] of panes) {
      if (usedPanes.has(paneKey) || pane.source !== 'claude') continue
      const subs = await this.subagents.read(pane)
      if (!subs.length || now - Math.max(...subs.map((sub) => sub.endedAt ?? now)) > SESSION_MAX_AGE_MS) continue
      sessionFlows.push(buildSessionFlow({ paneKey, terminal: terminalByPane.get(paneKey), mainState: pane.mainState, subagents: subs }))
    }
    sessionFlows.sort((a, b) => b.updatedAt - a.updatedAt)

    const teams = await attempt('Claude 팀', () => readClaudeTeams(this.home, { now }), [])
    const teamFlows = teams.map((team) => buildTeamFlow(team))

    const runs = [...orcaFlows, ...sessionFlows.slice(0, SESSION_LIMIT), ...teamFlows].sort((a, b) => b.updatedAt - a.updatedAt)
    return { runs, warnings }
  }
}
