import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { SubagentReader, readClaudeTeams, readHookStatus } from '../lib/local-sources.mjs'
import { attachSubagents, buildSessionFlow } from '../lib/subagent-flow.mjs'
import { buildTeamFlow } from '../lib/team-flow.mjs'

const flowWith = (agents) => ({ agents, events: [], agentStates: {}, updatedAt: 0, active: false })

test('attachSubagents adds spawn/result edges one column right of the parent', () => {
  const flow = flowWith([{ id: 'w', col: 1, role: 'worker' }])
  attachSubagents(
    flow,
    new Map([
      [
        'w',
        [
          { id: 'a', agentType: 'Explore', description: '코드 조사', depth: 1, startedAt: 10, endedAt: 20, state: 'done' },
          { id: 'b', agentType: 'Plan', description: '설계', depth: 2, startedAt: 30, endedAt: null, state: 'working' },
          { id: 'old', description: 'run 이전', startedAt: 1, endedAt: 2, state: 'done' }
        ]
      ]
    ]),
    { since: 5 }
  )
  const subs = flow.agents.filter((agent) => agent.role === 'subagent')
  assert.deepEqual(subs.map((sub) => [sub.name, sub.col]), [['코드 조사', 2], ['설계', 3]])
  assert.deepEqual(flow.events.map((e) => [e.kind, e.t]), [['spawn', 10], ['result', 20], ['spawn', 30]])
  assert.equal(flow.active, true)
  assert.equal(flow.updatedAt, 30)
})

test('buildSessionFlow puts the main agent first and ends it when idle', () => {
  const flow = buildSessionFlow({
    paneKey: 'tab:leaf',
    terminal: { handle: 'term_1', title: '◐ 리팩터링', branch: 'refs/heads/feat', agentIdentity: 'claude' },
    mainState: 'done',
    subagents: [{ id: 'a', description: '테스트 작성', startedAt: 100, endedAt: 200, state: 'done' }]
  })
  assert.equal(flow.source, 'session')
  assert.equal(flow.title, '리팩터링 · feat')
  assert.deepEqual(flow.agentStates.term_1, [[100, 'working'], [200, 'done']])
})

test('buildTeamFlow treats the lead first message as an assignment', () => {
  const flow = buildTeamFlow({
    name: 't1',
    config: {
      description: '주문 예측',
      leadAgentId: 'team-lead@t1',
      createdAt: 1000,
      members: [
        { agentId: 'team-lead@t1', name: 'team-lead', agentType: 'team-lead' },
        { name: 'analyst', agentType: 'general-purpose', model: 'opus', joinedAt: 1100 }
      ]
    },
    inboxes: new Map([
      ['analyst', [{ from: 'team-lead', text: '데이터 정리해\n자세히', timestamp: '1970-01-01T00:00:01.200Z' }, { from: 'team-lead', text: '추가 요청', timestamp: '1970-01-01T00:00:01.300Z' }]],
      ['team-lead', [{ from: 'analyst', text: '끝났어요', timestamp: '1970-01-01T00:00:01.400Z' }]]
    ]),
    tasks: [{ id: '1', subject: '정리', owner: 'analyst', status: 'in_progress' }]
  })
  assert.equal(flow.title, '주문 예측')
  assert.deepEqual(flow.events.map((e) => [e.kind, e.text]), [
    ['spawn', '합류 · general-purpose'],
    ['dispatch', '데이터 정리해'],
    ['message', '추가 요청'],
    ['message', '끝났어요']
  ])
  assert.equal(flow.agents.find((a) => a.name === 'analyst').cli, 'general-purpose · opus')
  assert.deepEqual([flow.tasks[0].owner, flow.tasks[0].status], ['team:t1:analyst', 'working'])
})

test('local readers merge transcript history with live hook subagents and read teams', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-flow-src-'))
  try {
    const transcript = join(root, 'session.jsonl')
    await mkdir(join(root, 'session', 'subagents'), { recursive: true })
    await writeFile(join(root, 'session', 'subagents', 'agent-a1.meta.json'), JSON.stringify({ agentType: 'Explore', description: '조사', spawnDepth: 1 }))
    await writeFile(
      join(root, 'session', 'subagents', 'agent-a1.jsonl'),
      `${JSON.stringify({ timestamp: '2026-10-14T08:00:00Z' })}\n${JSON.stringify({ timestamp: '2026-10-14T08:05:00Z' })}\n`
    )
    const userData = join(root, 'orca')
    await mkdir(join(userData, 'agent-hooks'), { recursive: true })
    await writeFile(
      join(userData, 'agent-hooks', 'last-status.json'),
      JSON.stringify({
        entries: {
          'tab:leaf': {
            paneKey: 'tab:leaf',
            source: 'claude',
            providerSession: { transcriptPath: transcript },
            payload: { state: 'working', subagents: [{ id: 'b2', state: 'working', startedAt: 5, agentType: 'Plan', description: '설계' }] }
          }
        }
      })
    )
    const panes = await readHookStatus(userData)
    const subs = await new SubagentReader().read(panes.get('tab:leaf'))
    assert.deepEqual(
      subs.map((s) => [s.id, s.state, s.description]),
      [['a1', 'done', '조사'], ['b2', 'working', '설계']]
    )
    assert.equal(subs[0].endedAt - subs[0].startedAt, 5 * 60_000)

    const teamDir = join(root, '.claude', 'teams', 'demo')
    await mkdir(join(teamDir, 'inboxes'), { recursive: true })
    await writeFile(join(teamDir, 'config.json'), JSON.stringify({ members: [{ name: 'lead' }, { name: 'dev' }] }))
    await writeFile(join(teamDir, 'inboxes', 'dev.json'), JSON.stringify([{ from: 'lead', text: 'hi', timestamp: '2026-10-14T08:00:00Z' }]))
    const teams = await readClaudeTeams(root)
    assert.deepEqual([teams.length, teams[0].name, teams[0].inboxes.get('dev').length, teams[0].active], [1, 'demo', 1, true])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('missing hook status degrades to no panes', async () => {
  assert.equal((await readHookStatus('/nonexistent/orca')).size, 0)
})
