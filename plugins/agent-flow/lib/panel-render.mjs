import { readFile, rename, writeFile } from 'node:fs/promises'

export const DATA_MARKER = '/*__AGENT_FLOW_DATA__*/null'

/** JSON safe to inline in a <script>: `</script>` and U+2028/9 cannot break out. */
export function inlineJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replaceAll(String.fromCharCode(0x2028), '\\u2028')
    .replaceAll(String.fromCharCode(0x2029), '\\u2029')
}

export function renderPanel(template, data) {
  if (!template.includes(DATA_MARKER)) throw new Error('panel template is missing the data marker')
  return template.replace(DATA_MARKER, () => inlineJson(data))
}

/** Writes only on change, via rename, so Orca's dev watcher reloads the panel once per real update. */
export async function writePanelIfChanged(path, html) {
  let current = null
  try {
    current = await readFile(path, 'utf8')
  } catch {
    // Missing file: write it.
  }
  if (current === html) return false
  const temp = `${path}.${process.pid}.tmp`
  await writeFile(temp, html, 'utf8')
  await rename(temp, path)
  return true
}
