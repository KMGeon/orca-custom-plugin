import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { orcaCliCandidates } from '../lib/orca-cli.mjs'
import { DATA_MARKER, inlineJson, renderPanel, writePanelIfChanged } from '../lib/panel-render.mjs'

test('inlined JSON cannot close the script tag or break the line', () => {
  const json = inlineJson({ text: `</script><b>${String.fromCharCode(0x2028)}` })
  assert.ok(!json.includes('</script>'))
  assert.ok(!json.includes(String.fromCharCode(0x2028)))
  assert.deepEqual(JSON.parse(json), { text: `</script><b>${String.fromCharCode(0x2028)}` })
})

test('renderPanel replaces the marker and refuses templates without one', () => {
  assert.equal(renderPanel(`var D = ${DATA_MARKER}`, { a: 1 }), 'var D = {"a":1}')
  assert.equal(renderPanel(`var D = ${DATA_MARKER}`, { a: '$&' }), 'var D = {"a":"$&"}')
  assert.throws(() => renderPanel('no marker', {}))
})

test('writePanelIfChanged writes only when content differs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-flow-'))
  try {
    const path = join(dir, 'index.html')
    assert.equal(await writePanelIfChanged(path, 'a'), true)
    assert.equal(await writePanelIfChanged(path, 'a'), false)
    assert.equal(await writePanelIfChanged(path, 'b'), true)
    assert.equal(await readFile(path, 'utf8'), 'b')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CLI lookup prefers the override, then the bundle beside the worker binary', () => {
  const candidates = orcaCliCandidates({
    override: '/custom/orca',
    execPath: '/Applications/Orca.app/Contents/MacOS/Orca',
    env: { PATH: '/usr/local/bin' },
    platform: 'darwin'
  })
  assert.equal(candidates[0], '/custom/orca')
  assert.equal(candidates[1], '/Applications/Orca.app/Contents/Resources/bin/orca')
  assert.ok(candidates.includes('/usr/local/bin/orca'))
})
