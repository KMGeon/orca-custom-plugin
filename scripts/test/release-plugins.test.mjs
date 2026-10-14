import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { release } from '../release-plugins.mjs'

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

async function fixtureRepo() {
  const root = await mkdtemp(join(tmpdir(), 'orca-release-'))
  git(root, 'init', '-q')
  git(root, 'config', 'user.name', 'test')
  git(root, 'config', 'user.email', 'test@example.com')
  await writeFile(
    join(root, 'marketplace.config.json'),
    JSON.stringify({
      name: 'Test',
      owner: 'tester',
      repositoryUrl: 'git@github.com:tester/plugins.git',
      plugins: { hidden: { listed: false, reason: 'dev only' }, notify: { categories: ['notifications'] } }
    })
  )
  for (const id of ['notify', 'hidden']) {
    await mkdir(join(root, 'plugins', id), { recursive: true })
    await writeFile(join(root, 'plugins', id, 'orca-plugin.json'), JSON.stringify({ id, publisher: 'tester', version: '1.0.0', description: `${id} plugin` }))
    await writeFile(join(root, 'plugins', id, 'main.mjs'), 'export default () => {}\n')
  }
  git(root, 'add', '-A')
  git(root, 'commit', '-qm', 'init')
  return root
}

test('release tags each listed plugin folder as a root commit and lists it in the marketplace', async () => {
  const root = await fixtureRepo()
  try {
    const result = release(root, { tag: true, write: true, log: () => {} })
    assert.deepEqual(result.created, ['notify-v1.0.0'])
    assert.equal(git(root, 'rev-parse', 'notify-v1.0.0^{tree}'), git(root, 'rev-parse', 'HEAD:plugins/notify'))
    assert.deepEqual(git(root, 'ls-tree', '--name-only', 'notify-v1.0.0').split('\n'), ['main.mjs', 'orca-plugin.json'])
    assert.equal(git(root, 'tag', '--list', 'hidden-*'), '')

    const marketplace = JSON.parse(await readFile(join(root, 'orca-marketplace.json'), 'utf8'))
    assert.deepEqual(marketplace, {
      name: 'Test',
      owner: 'tester',
      plugins: [
        {
          id: 'tester.notify',
          source: { kind: 'git', url: 'git@github.com:tester/plugins.git', ref: 'notify-v1.0.0' },
          description: 'notify plugin',
          categories: ['notifications']
        }
      ]
    })

    const again = release(root, { tag: true, write: true, log: () => {} })
    assert.deepEqual([again.created, again.changed], [[], false])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('changing a plugin without a version bump keeps the old tag and warns', async () => {
  const root = await fixtureRepo()
  try {
    release(root, { tag: true, write: true, log: () => {} })
    await writeFile(join(root, 'plugins', 'notify', 'main.mjs'), 'export default () => 1\n')
    git(root, 'commit', '-qam', 'change')
    const lines = []
    const result = release(root, { tag: true, write: true, log: (line) => lines.push(line) })
    assert.deepEqual(result.created, [])
    assert.ok(lines.some((line) => line.includes('version을 올리세요')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
