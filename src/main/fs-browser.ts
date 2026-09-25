import { readdir } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { fileKind } from './file-handler'
import type { DirListing, DirEntry } from '../shared/api'

/**
 * Lists every item in the folder, including files the app cannot open, so the
 * explorer can show disabled entries as navigation context.
 */
export async function listDirectory(dir: string): Promise<DirListing | null> {
  const full = resolve(dir)
  try {
    const raw = await readdir(full, { withFileTypes: true })
    const entries: DirEntry[] = []
    for (const item of raw) {
      if (item.name.startsWith('.')) continue
      const isDirectory = item.isDirectory()
      entries.push({
        name: item.name,
        path: join(full, item.name),
        isDirectory,
        kind: isDirectory ? 'directory' : fileKind(item.name)
      })
    }
    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name, 'en-US', { numeric: true, sensitivity: 'base' })
    })
    const parent = dirname(full)
    return { dir: full, parent: parent === full ? null : parent, entries }
  } catch {
    return null
  }
}
