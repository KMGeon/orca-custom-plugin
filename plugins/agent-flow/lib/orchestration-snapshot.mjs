import { buildRunFlow } from './flow-model.mjs'
import { runOrcaJson } from './orca-cli.mjs'

export const RECENT_RUN_LIMIT = 6
const INBOX_LIMIT = 500
const FINAL_DISPATCH = new Set(['completed', 'failed', 'circuit_broken'])

/** Reads recent runs through the `orca` CLI. Finished dispatches are cached so polls stay cheap. */
export class OrchestrationSnapshotter {
  constructor(cliPath, run = runOrcaJson) {
    this.cliPath = cliPath
    this.run = run
    this.dispatchCache = new Map()
    this.seenLive = new Set()
  }

  async snapshot() {
    const cli = (args) => this.run(this.cliPath, args)
    const [{ runs = [] }, { messages = [] }, { terminals = [] }] = await Promise.all([
      cli(['orchestration', 'run-list']),
      cli(['orchestration', 'inbox', '--limit', String(INBOX_LIMIT)]),
      cli(['terminal', 'list', '--limit', '500'])
    ])
    const terminalByHandle = new Map(terminals.map((terminal) => [terminal.handle, terminal]))
    const goneHandles = new Set([...this.seenLive].filter((handle) => !terminalByHandle.has(handle)))
    for (const handle of terminalByHandle.keys()) this.seenLive.add(handle)
    const recent = [...runs]
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, RECENT_RUN_LIMIT)

    const flows = []
    for (const run of recent) {
      const { tasks = [] } = await cli(['orchestration', 'task-list', '--run', run.id])
      const dispatches = new Map()
      for (const task of tasks) {
        const dispatch = await this.dispatchFor(cli, task)
        if (dispatch) dispatches.set(task.id, dispatch)
      }
      flows.push(
        buildRunFlow({
          run,
          tasks,
          dispatches,
          messages: messages.filter((message) => message.run_id === run.id),
          terminals: terminalByHandle,
          goneHandles
        })
      )
    }
    return { flows, terminals }
  }

  async dispatchFor(cli, task) {
    if (task.status === 'pending' || task.status === 'ready') return null
    const cached = this.dispatchCache.get(task.id)
    if (cached) return cached
    try {
      const { dispatch } = await cli(['orchestration', 'dispatch-show', '--task', task.id])
      if (dispatch && FINAL_DISPATCH.has(dispatch.status)) this.dispatchCache.set(task.id, dispatch)
      return dispatch ?? null
    } catch {
      // A task without a dispatch row still renders, just without an owner.
      return null
    }
  }
}
