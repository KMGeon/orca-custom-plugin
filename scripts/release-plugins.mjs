#!/usr/bin/env node
// Orca installs a plugin from the ROOT of a git ref, so each plugins/<id> folder is published as
// its own root commit under the tag `<id>-v<version>`, and orca-marketplace.json lists those tags.
//
//   node scripts/release-plugins.mjs                 # plan only
//   node scripts/release-plugins.mjs --tag --write   # create missing tags, rewrite orca-marketplace.json
//   node scripts/release-plugins.mjs --tag --push --write   # CI: also push the new tags
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const MARKETPLACE_FILE = 'orca-marketplace.json'

function git(cwd, args, options = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim()
}

function tryGit(cwd, args) {
  try {
    return git(cwd, args)
  } catch {
    return null
  }
}

export function readPlugins(root) {
  const dir = join(root, 'plugins')
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, 'orca-plugin.json')))
    .map((entry) => {
      const manifest = JSON.parse(readFileSync(join(dir, entry.name, 'orca-plugin.json'), 'utf8'))
      if (manifest.id !== entry.name) throw new Error(`plugins/${entry.name}: manifest id "${manifest.id}" must match the folder name`)
      return { id: manifest.id, manifest, tag: `${manifest.id}-v${manifest.version}` }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}

export function buildMarketplace(config, releases) {
  return {
    name: config.name,
    owner: config.owner,
    plugins: releases
      .filter((release) => release.listed && release.tagExists)
      .map((release) => ({
        id: `${release.manifest.publisher}.${release.id}`,
        source: { kind: 'git', url: config.repositoryUrl, ref: release.tag },
        ...(release.manifest.description ? { description: release.manifest.description } : {}),
        categories: config.plugins?.[release.id]?.categories ?? []
      }))
  }
}

export function release(root, { tag = false, push = false, write = false, log = console.log } = {}) {
  const config = JSON.parse(readFileSync(join(root, 'marketplace.config.json'), 'utf8'))
  const releases = []
  const created = []
  for (const plugin of readPlugins(root)) {
    const listed = config.plugins?.[plugin.id]?.listed !== false
    const entry = { ...plugin, listed, tagExists: false }
    releases.push(entry)
    if (!listed) {
      log(`- ${plugin.id}: 목록 제외 (${config.plugins[plugin.id].reason ?? 'listed: false'})`)
      continue
    }
    const tree = git(root, ['rev-parse', `HEAD:plugins/${plugin.id}`])
    const taggedTree = tryGit(root, ['rev-parse', '--verify', '--quiet', `refs/tags/${plugin.tag}^{tree}`])
    if (taggedTree) {
      entry.tagExists = true
      log(taggedTree === tree ? `= ${plugin.tag}: 최신` : `! ${plugin.tag}: 태그 이후 내용이 바뀌었습니다. 배포하려면 version을 올리세요.`)
      continue
    }
    if (!tag) {
      log(`+ ${plugin.tag}: 새 태그 예정`)
      continue
    }
    const commit = git(root, ['commit-tree', tree, '-m', `release: ${plugin.id} v${plugin.manifest.version}`])
    git(root, ['tag', plugin.tag, commit])
    entry.tagExists = true
    created.push(plugin.tag)
    log(`+ ${plugin.tag}: 태그 생성 (${commit.slice(0, 7)})`)
  }

  if (push && created.length) git(root, ['push', 'origin', ...created.map((name) => `refs/tags/${name}`)])

  const marketplace = `${JSON.stringify(buildMarketplace(config, releases), null, 2)}\n`
  const path = join(root, MARKETPLACE_FILE)
  const changed = !existsSync(path) || readFileSync(path, 'utf8') !== marketplace
  if (write && changed) writeFileSync(path, marketplace)
  log(changed ? `${MARKETPLACE_FILE}: ${write ? '갱신함' : '갱신 필요'}` : `${MARKETPLACE_FILE}: 변경 없음`)
  return { created, changed }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const flags = new Set(process.argv.slice(2))
  release(resolve(new URL('..', import.meta.url).pathname), {
    tag: flags.has('--tag'),
    push: flags.has('--push'),
    write: flags.has('--write')
  })
}
