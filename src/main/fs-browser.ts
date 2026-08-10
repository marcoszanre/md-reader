import { readdir } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { isMarkdownPath } from './file-handler'
import type { DirListing, DirEntry } from '../shared/api'

/** Lista pastas e arquivos Markdown de um diretório, para a navegação lateral. */
export async function listDirectory(dir: string): Promise<DirListing | null> {
  const full = resolve(dir)
  try {
    const raw = await readdir(full, { withFileTypes: true })
    const entries: DirEntry[] = []
    for (const item of raw) {
      if (item.name.startsWith('.')) continue
      const isDirectory = item.isDirectory()
      if (!isDirectory && !isMarkdownPath(item.name)) continue
      entries.push({ name: item.name, path: join(full, item.name), isDirectory })
    }
    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name, 'pt-BR', { numeric: true, sensitivity: 'base' })
    })
    const parent = dirname(full)
    return { dir: full, parent: parent === full ? null : parent, entries }
  } catch {
    return null
  }
}
