import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildRunFlow, cleanTerminalTitle, parseTime, worktreeNameFromIncarnation } from '../lib/flow-model.mjs'

const COORD = 'term_coord'
const run = { id: 'run_1', objective: '텔레그램 페이지 추가\n세부 설명', coordinator_handle: COORD, created_at: '2026-10-14 08:00:00' }
const task = (id, fields = {}) => ({
  id,
  task_title: `${id} 제목`,
  status: 'completed',
  deps: '[]',
  parent_id: null,
  created_by_terminal_handle: COORD,
  created_at: '2026-10-14 08:01:00',
  completed_at: '2026-10-14T08:10:00.000Z',
  ...fields
})
const dispatch = (id, assignee, fields = {}) => ({
  id,
  assignee_handle: assignee,
  status: 'completed',
  dispatched_at: '2026-10-14 08:02:00',
  process_incarnation: `pty::/Users/me/work/${assignee}-tree@@abc:uuid`,
  ...fields
})

test('parseTime treats zone-less Orca timestamps as UTC', () => {
  assert.equal(parseTime('2026-10-14 08:00:00'), Date.parse('2026-10-14T08:00:00Z'))
  assert.equal(parseTime('2026-10-14T08:00:00.000Z'), Date.parse('2026-10-14T08:00:00Z'))
  assert.equal(parseTime(null), null)
  assert.equal(parseTime('nope'), null)
})

test('terminal titles drop spinner glyphs and incarnations yield the worktree name', () => {
  assert.equal(cleanTerminalTitle('◐ Orca CLI의 SQLite 접근'), 'Orca CLI의 SQLite 접근')
  assert.equal(worktreeNameFromIncarnation('id::/a/b/my-worktree@@14f2:uuid'), 'my-worktree')
  assert.equal(worktreeNameFromIncarnation(undefined), '')
})

test('dispatch and completion become events between creator and assignee', () => {
  const flow = buildRunFlow({
    run,
    tasks: [task('T1')],
    dispatches: new Map([['T1', dispatch('ctx_1', 'term_a')]]),
    messages: [{ type: 'worker_done', from_handle: 'dispatch:ctx_1', to_handle: 'run:run_1', subject: 'T1 끝남', payload: '{"taskId":"T1"}', created_at: '2026-10-14T08:10:00Z' }]
  })
  assert.deepEqual(
    flow.events.map((e) => [e.kind, e.from, e.to, e.text]),
    [
      ['dispatch', COORD, 'term_a', 'T1 제목'],
      ['result', 'term_a', COORD, 'T1 끝남']
    ]
  )
  assert.equal(flow.title, '텔레그램 페이지 추가')
  assert.equal(flow.active, false)
  const worker = flow.agents.find((a) => a.id === 'term_a')
  assert.equal(worker.name, 'T1 제목', 'closed terminal falls back to its first task')
  assert.equal(worker.branch, 'term_a-tree')
  assert.equal(worker.col, 1)
})

test('live terminal metadata names the agent', () => {
  const flow = buildRunFlow({
    run,
    tasks: [task('T1', { status: 'dispatched', completed_at: null })],
    dispatches: new Map([['T1', dispatch('ctx_1', 'term_a', { status: 'dispatched' })]]),
    terminals: new Map([['term_a', { title: '✳ UI 작업자', branch: 'refs/heads/feat-ui', agentIdentity: 'claude' }]])
  })
  const worker = flow.agents.find((a) => a.id === 'term_a')
  assert.deepEqual([worker.name, worker.branch, worker.cli, worker.live], ['UI 작업자', 'feat-ui', 'claude', true])
  assert.equal(flow.active, true)
  assert.deepEqual(flow.agentStates.term_a.map((s) => s[1]), ['working'])
})

test('messages map to ask/reply and drive blocked state', () => {
  const flow = buildRunFlow({
    run,
    tasks: [task('T1', { status: 'dispatched', completed_at: null })],
    dispatches: new Map([['T1', dispatch('ctx_1', 'term_a', { status: 'dispatched' })]]),
    messages: [
      { type: 'question', from_handle: 'dispatch:ctx_1', to_handle: 'run:run_1', subject: '아이콘 위치?', created_at: '2026-10-14T08:03:00Z' },
      { type: 'status', thread_id: 'th_1', from_handle: COORD, to_handle: 'term_a', subject: '하단', created_at: '2026-10-14T08:04:00Z' },
      { type: 'heartbeat', from_handle: 'term_a', to_handle: COORD, created_at: '2026-10-14T08:05:00Z' }
    ]
  })
  assert.deepEqual(flow.events.map((e) => e.kind), ['dispatch', 'ask', 'reply'])
  assert.deepEqual(flow.agentStates.term_a.map((s) => s[1]), ['working', 'blocked', 'working'])
})

test('nested dispatch puts the sub-worker in the next column', () => {
  const flow = buildRunFlow({
    run,
    tasks: [task('T1'), task('T2', { created_by_terminal_handle: 'term_a', created_at: '2026-10-14 08:05:00' })],
    dispatches: new Map([
      ['T1', dispatch('ctx_1', 'term_a')],
      ['T2', dispatch('ctx_2', 'term_b', { dispatched_at: '2026-10-14 08:06:00' })]
    ])
  })
  assert.equal(flow.agents.find((a) => a.id === 'term_b').col, 2)
})

test('a finished task without a dispatch row still reports its final state', () => {
  const flow = buildRunFlow({ run, tasks: [task('T1')] })
  assert.equal(flow.tasks[0].owner, null)
  assert.equal(flow.tasks[0].states.at(-1)[1], 'done')
  assert.equal(flow.events.length, 0)
})

test('duplicate agent names get a numeric suffix', () => {
  const terminals = new Map([
    ['term_a', { title: 'reviewer' }],
    ['term_b', { title: 'reviewer' }]
  ])
  const flow = buildRunFlow({
    run,
    tasks: [task('T1'), task('T2')],
    dispatches: new Map([
      ['T1', dispatch('ctx_1', 'term_a')],
      ['T2', dispatch('ctx_2', 'term_b')]
    ]),
    terminals
  })
  assert.deepEqual(flow.agents.filter((a) => a.role === 'worker').map((a) => a.name), ['reviewer', 'reviewer #2'])
})
