#!/usr/bin/env node
// Renders the panel once outside Orca.
//   node scripts/render.mjs              -> waiting placeholder into panel/index.html
//   node scripts/render.mjs --live [out] -> real `orca orchestration` data (default: panel/index.html)
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveOrcaCli } from '../lib/orca-cli.mjs'
import { OrchestrationSnapshotter } from '../lib/orchestration-snapshot.mjs'
import { renderPanel } from '../lib/panel-render.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const live = process.argv.includes('--live')
const out = resolve(process.argv.slice(2).find((arg) => !arg.startsWith('--')) ?? join(root, 'panel', 'index.html'))

let data = null
if (live) {
  const cli = resolveOrcaCli()
  if (!cli) throw new Error('orca CLI not found')
  data = { version: 1, runs: await new OrchestrationSnapshotter(cli).snapshot(), error: null }
}
const template = await readFile(join(root, 'panel', 'template.html'), 'utf8')
await writeFile(out, renderPanel(template, data))
console.log(`wrote ${out}${data ? ` (${data.runs.length} runs)` : ' (placeholder)'}`)
