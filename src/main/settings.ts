import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname, isAbsolute } from 'node:path'
import { isOpenablePath } from './file-handler'
import {
  DEFAULT_SETTINGS,
  MAX_RECENT_FILES,
  MIN_TOC_WIDTH,
  MAX_TOC_WIDTH,
  MIN_SIDEBAR_SPLIT,
  MAX_SIDEBAR_SPLIT,
  type Settings
} from '../shared/types'

let cache: Settings | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function coerce(raw: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS, windowBounds: { ...DEFAULT_SETTINGS.windowBounds } }
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Record<string, unknown>

  if (typeof r.windowMaximized === 'boolean') out.windowMaximized = r.windowMaximized
  if (r.theme === 'light' || r.theme === 'dark' || r.theme === 'system') out.theme = r.theme
  if (typeof r.zoom === 'number' && Number.isFinite(r.zoom)) out.zoom = Math.min(3, Math.max(0.5, r.zoom))
  if (typeof r.tocVisible === 'boolean') out.tocVisible = r.tocVisible
  if (typeof r.minimapVisible === 'boolean') out.minimapVisible = r.minimapVisible
  if (typeof r.tocWidth === 'number' && Number.isFinite(r.tocWidth)) {
    out.tocWidth = Math.min(MAX_TOC_WIDTH, Math.max(MIN_TOC_WIDTH, Math.round(r.tocWidth)))
  }
  if (typeof r.sidebarSplit === 'number' && Number.isFinite(r.sidebarSplit)) {
    out.sidebarSplit = Math.min(MAX_SIDEBAR_SPLIT, Math.max(MIN_SIDEBAR_SPLIT, r.sidebarSplit))
  }
  if (r.readingWidth === 'comfortable' || r.readingWidth === 'full') out.readingWidth = r.readingWidth
  if (typeof r.loadRemoteImages === 'boolean') out.loadRemoteImages = r.loadRemoteImages
  if (Array.isArray(r.recentFiles)) {
    // Only absolute paths for files the app can open are stored in the list.
    out.recentFiles = r.recentFiles
      .filter((p): p is string => typeof p === 'string' && isAbsolute(p) && isOpenablePath(p))
      .slice(0, MAX_RECENT_FILES)
  }
  const b = r.windowBounds as Record<string, unknown> | undefined
  if (b && typeof b === 'object') {
    const width = typeof b.width === 'number' && Number.isFinite(b.width) ? b.width : null
    const height = typeof b.height === 'number' && Number.isFinite(b.height) ? b.height : null
    if (width !== null && height !== null) {
      out.windowBounds = {
        // x/y may be negative on displays to the left of or above the primary display.
        x: typeof b.x === 'number' && Number.isFinite(b.x) ? Math.round(b.x) : null,
        y: typeof b.y === 'number' && Number.isFinite(b.y) ? Math.round(b.y) : null,
        width: Math.max(400, Math.round(width)),
        height: Math.max(300, Math.round(height))
      }
    }
  }
  return out
}

export function getSettings(): Settings {
  if (cache) return cache
  try {
    cache = coerce(JSON.parse(readFileSync(settingsPath(), 'utf8')))
  } catch {
    // Corrupt or missing settings: use defaults and never crash.
    cache = coerce(null)
  }
  return cache
}

export function setSettings(patch: Partial<Settings>): Settings {
  const next = coerce({ ...getSettings(), ...patch })
  cache = next
  try {
    mkdirSync(dirname(settingsPath()), { recursive: true })
    writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8')
  } catch {
    // A write failure must not crash the app.
  }
  return next
}

export function addRecentFile(filePath: string): void {
  const current = getSettings().recentFiles.filter((p) => p.toLowerCase() !== filePath.toLowerCase())
  current.unshift(filePath)
  setSettings({ recentFiles: current.slice(0, MAX_RECENT_FILES) })
}
