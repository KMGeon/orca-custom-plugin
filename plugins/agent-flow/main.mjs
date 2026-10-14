import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveOrcaCli } from './lib/orca-cli.mjs'
import { OrchestrationSnapshotter } from './lib/orchestration-snapshot.mjs'
import { FlowCollector } from './lib/snapshot.mjs'
import { renderPanel, writePanelIfChanged } from './lib/panel-render.mjs'

const ROOT = dirname(fileURLToPath(import.meta.url))
const TEMPLATE_PATH = join(ROOT, 'panel', 'template.html')
const PANEL_PATH = join(ROOT, 'panel', 'index.html')
// Non-dev installs live in a content-addressed copy that Orca neither watches nor lets us modify.
const INSTALLED_COPY = /[\\/]plugins[\\/][^\\/]+[\\/][0-9a-f]{64}$/.test(ROOT)

const ACTIVE_POLL_MS = 3_000
const QUIET_POLL_MS = 15_000
// Orca reaps a worker after 5 idle minutes; stop polling well after the last run activity so it can.
const STOP_AFTER_QUIET_MS = 10 * 60_000
const NUDGE_DEBOUNCE_MS = 800

export default function activate(orca) {
  if (INSTALLED_COPY) {
    orca.log('설치 복사본에서는 패널을 갱신할 수 없습니다. 설정 → 플러그인 → 개발에 이 폴더의 원본 경로를 추가하세요.')
    orca.commands.register('agent-flow-refresh', async () => ({ error: 'dev-path install required' }))
    return
  }
  const worker = new AgentFlowWorker(orca)
  orca.commands.register('agent-flow-refresh', async () => {
    const result = await worker.refresh()
    worker.schedule()
    return result
  })
  orca.events.on('agent.status.changed', () => worker.nudge())
  worker.nudge()
}

class AgentFlowWorker {
  constructor(orca) {
    this.orca = orca
    this.inflight = null
    this.timer = null
    this.lastActivityAt = Date.now()
    this.collector = null
  }

  nudge() {
    this.lastActivityAt = Date.now()
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.tick(), NUDGE_DEBOUNCE_MS)
  }

  async tick() {
    const { anyActive } = await this.refresh()
    if (anyActive) this.lastActivityAt = Date.now()
    this.schedule(anyActive)
  }

  schedule(anyActive = false) {
    clearTimeout(this.timer)
    if (!anyActive && Date.now() - this.lastActivityAt > STOP_AFTER_QUIET_MS) {
      this.orca.log('no active runs; polling paused until the next agent event')
      return
    }
    this.timer = setTimeout(() => this.tick(), anyActive ? ACTIVE_POLL_MS : QUIET_POLL_MS)
  }

  refresh() {
    this.inflight ??= this.render().finally(() => {
      this.inflight = null
    })
    return this.inflight
  }

  async render() {
    let data
    try {
      this.collector ??= this.createCollector()
      const { runs, warnings } = await this.collector.collect()
      data = { version: 2, runs, warnings, error: null }
    } catch (error) {
      this.collector = null
      data = { version: 2, runs: [], warnings: [], error: error?.message ?? String(error) }
      this.orca.log(`refresh failed: ${data.error}`)
    }
    const template = await readFile(TEMPLATE_PATH, 'utf8')
    const changed = await writePanelIfChanged(PANEL_PATH, renderPanel(template, data))
    // A host call is what counts as activity for Orca's idle reaper; a read avoids audit-log rows.
    await this.orca.host.call('storage.keys', {}).catch(() => undefined)
    const anyActive = data.runs.some((run) => run.active)
    return { changed, runs: data.runs.length, anyActive, error: data.error }
  }

  createCollector() {
    const cliPath = resolveOrcaCli()
    if (!cliPath) throw new Error('orca CLI를 찾지 못했습니다. Orca 설정에서 CLI를 설치하세요.')
    return new FlowCollector({ orcaSnapshotter: new OrchestrationSnapshotter(cliPath) })
  }
}
