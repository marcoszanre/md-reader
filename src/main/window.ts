import { BrowserWindow, shell, dialog, app, nativeTheme, screen } from 'electron'
import { join, dirname, basename, resolve } from 'node:path'
import {
  FileWatcher,
  readMarkdownFile,
  readOpenedFile,
  isMarkdownPath,
  FileReadError,
  FileWriteError,
  writeMarkdownFile
} from './file-handler'
import { normalizeDir, isWithin, canBrowse, nextBrowseRoot, assetRoot } from './browse-scope'
import { getSettings, setSettings, addRecentFile } from './settings'
import { setAssetRoots } from './protocol'
import { disposeWindow } from './copilot'
import type { Settings } from '../shared/types'
import type { SaveRequest, SaveResult } from '../shared/api'
import { MARKDOWN_EXTENSIONS, IMAGE_EXTENSIONS } from '../shared/types'

interface WindowState {
  watcher: FileWatcher
  currentPath: string | null
  /** Highest folder the user has browsed to; defines the explorer scope. */
  browseRoot: string | null
  /** The renderer has unsaved edits for `currentPath`. */
  dirty: boolean
}

const states = new Map<number, WindowState>()

/**
 * Image root for a window. It matches the explorer root (the highest folder the
 * user reached), with at least the document parent folder because references
 * such as `../evidence/photo.png` are common in documentation repositories.
 */
function assetRootFor(state: WindowState): string | null {
  if (!state.currentPath) return null
  const docDir = dirname(state.currentPath)
  return assetRoot(docDir, dirname(docDir), state.browseRoot)
}

/** The image allowlist contains only folders related to open documents. */
function syncAssetRoots(): void {
  const dirs = [...states.values()]
    .map((state) => assetRootFor(state))
    .filter((dir): dir is string => !!dir)
  setAssetRoots(dirs)
}

/** Native window control colors aligned with the app theme. */
export function titleBarOverlayFor(theme: Settings['theme']): Electron.TitleBarOverlay {
  const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors)
  return dark
    ? { color: '#161b22', symbolColor: '#e6edf3', height: 44 }
    : { color: '#f6f8fa', symbolColor: '#1f2328', height: 44 }
}

export function applyTitleBarTheme(theme: Settings['theme']): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.setTitleBarOverlay(titleBarOverlayFor(theme))
    } catch {
      // Platform without overlay support: ignore.
    }
  }
}

/**
 * Keeps the window on the display where it was. If that display no longer exists
 * (or the window would be outside the visible area), reposition it in the work
 * area of the nearest display.
 */
function restoreBounds(saved: Settings['windowBounds']): Electron.Rectangle | null {
  if (saved.x === null || saved.y === null) return null

  const candidate = { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
  const display = screen.getDisplayMatching(candidate)
  const area = display.workArea

  const visibleX = Math.min(candidate.x + candidate.width, area.x + area.width) - Math.max(candidate.x, area.x)
  const visibleY = Math.min(candidate.y + candidate.height, area.y + area.height) - Math.max(candidate.y, area.y)
  const mostlyVisible = visibleX > 120 && visibleY > 80
  if (mostlyVisible) return candidate

  const width = Math.min(candidate.width, area.width)
  const height = Math.min(candidate.height, area.height)
  return {
    width,
    height,
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2)
  }
}

/** Saves the restored position/size and the maximized window state. */
function persistWindowState(win: BrowserWindow): void {
  if (win.isDestroyed() || win.isMinimized()) return
  const maximized = win.isMaximized() || win.isFullScreen()
  const b = win.getNormalBounds()
  setSettings({
    windowMaximized: maximized,
    windowBounds: { x: b.x, y: b.y, width: b.width, height: b.height }
  })
}

export function stateFor(win: BrowserWindow): WindowState | undefined {
  return states.get(win.id)
}

export function currentPathOf(win: BrowserWindow): string | null {
  return states.get(win.id)?.currentPath ?? null
}

export function createWindow(filePath?: string | null): BrowserWindow {
  const settings = getSettings()
  const bounds = restoreBounds(settings.windowBounds)

  const win = new BrowserWindow({
    width: bounds?.width ?? settings.windowBounds.width,
    height: bounds?.height ?? settings.windowBounds.height,
    ...(bounds ? { x: bounds.x, y: bounds.y } : {}),
    minWidth: 480,
    minHeight: 360,
    show: false,
    autoHideMenuBar: true,
    // Custom title bar: the file name needs to be large and readable.
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarOverlayFor(settings.theme),
    backgroundColor: settings.theme === 'light' ? '#ffffff' : '#0d1117',
    title: 'MD Reader',
    icon: join(__dirname, '../../resources/icon.ico'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false,
      v8CacheOptions: 'code'
    }
  })

  win.removeMenu()

  // Maximize before showing so the window appears on the correct monitor without flicker.
  if (settings.windowMaximized) win.maximize()

  const watcher = new FileWatcher((changed) => {
    void reloadFile(win, changed, true)
  })
  states.set(win.id, { watcher, currentPath: null, browseRoot: null, dirty: false })

  win.once('ready-to-show', () => win.show())

  // Also save state during use so the latest position/display remains preserved
  // if the OS terminates the app.
  let saveTimer: NodeJS.Timeout | null = null
  const scheduleSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => persistWindowState(win), 400)
  }
  win.on('moved', scheduleSave)
  win.on('resized', scheduleSave)
  win.on('maximize', scheduleSave)
  win.on('unmaximize', scheduleSave)

  win.on('close', (event) => {
    const state = states.get(win.id)
    if (state?.dirty && !win.webContents.isDestroyed()) {
      const choice = dialog.showMessageBoxSync(win, {
        type: 'warning',
        title: 'Unsaved changes',
        message: `Do you want to save the changes to ${documentName(state)}?`,
        detail: 'Your changes will be lost if you do not save them.',
        buttons: ['Save', "Don't save", 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        noLink: true
      })
      if (choice !== 1) {
        event.preventDefault()
        // The renderer owns the edited text: it saves and then closes the window itself.
        if (choice === 0) win.webContents.send('editor:saveAndClose')
        return
      }
      state.dirty = false
    }
    if (saveTimer) clearTimeout(saveTimer)
    persistWindowState(win)
  })

  win.on('closed', () => {
    states.get(win.id)?.watcher.stop()
    states.delete(win.id)
    syncAssetRoots()
    void disposeWindow(win.id)
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalSafely(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    const isDev = !app.isPackaged && url.startsWith(process.env.ELECTRON_RENDERER_URL ?? '\u0000')
    if (isDev) return
    event.preventDefault()
    void openExternalSafely(url)
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.webContents.once('did-finish-load', () => {
    if (filePath) void openFileInWindow(win, filePath)
  })

  return win
}

export async function openExternalSafely(url: string): Promise<void> {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
      await shell.openExternal(url)
    }
  } catch {
    // Invalid URL: ignore silently.
  }
}

function documentName(state: WindowState): string {
  return state.currentPath ? `"${basename(state.currentPath)}"` : 'this document'
}

/** Asks before discarding unsaved edits. Resolves to `true` when it is safe to replace the document. */
export async function confirmDiscard(win: BrowserWindow): Promise<boolean> {
  const state = states.get(win.id)
  if (!state?.dirty) return true
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    title: 'Unsaved changes',
    message: `Discard the unsaved changes to ${documentName(state)}?`,
    detail: 'Your edits will be lost. This cannot be undone.',
    buttons: ['Discard changes', 'Keep editing'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  })
  if (response !== 0) return false
  state.dirty = false
  return true
}

/** Asks before overwriting a file that another program changed while it was being edited. */
export async function confirmOverwrite(win: BrowserWindow): Promise<boolean> {
  const state = states.get(win.id)
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    title: 'File changed on disk',
    message: `${state ? documentName(state) : 'This document'} was changed by another program.`,
    detail: 'Saving now replaces the version on disk with your edits. Do you want to overwrite it?',
    buttons: ['Overwrite', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  })
  return response === 0
}

export function setDirty(win: BrowserWindow, dirty: boolean): void {
  const state = states.get(win.id)
  if (state) state.dirty = dirty && !!state.currentPath && isMarkdownPath(state.currentPath)
}

/**
 * Saves the window's current Markdown document. The path always comes from the
 * main-process state; the renderer only states which document it believes it is
 * editing, and a mismatch is rejected instead of writing somewhere unexpected.
 */
export async function saveCurrentDocument(win: BrowserWindow, request: SaveRequest): Promise<SaveResult> {
  const state = states.get(win.id)
  const current = state?.currentPath
  if (!state || !current || !isMarkdownPath(current)) {
    return { ok: false, reason: 'invalid', message: 'There is no Markdown document to save in this window.' }
  }
  if (resolve(request.path).toLowerCase() !== current.toLowerCase()) {
    return {
      ok: false,
      reason: 'stale',
      message: 'The open document changed before the save completed. Your edits were not written.'
    }
  }
  try {
    const { mtimeMs } = await writeMarkdownFile(current, request.content, {
      expectedMtimeMs: request.expectedMtimeMs,
      force: request.force
    })
    // Restart the watcher so the app's own save is not reported back as an external change.
    state.watcher.watchFile(current)
    addRecentFile(current)
    return { ok: true, mtimeMs }
  } catch (err) {
    if (err instanceof FileWriteError) {
      return { ok: false, reason: err.conflict ? 'conflict' : 'error', message: err.message }
    }
    return { ok: false, reason: 'error', message: `Unexpected error while saving:\n${current}` }
  }
}

export async function openFileInWindow(win: BrowserWindow, filePath: string): Promise<void> {
  const state = states.get(win.id)
  let payload: Awaited<ReturnType<typeof readOpenedFile>>
  try {
    payload = await readOpenedFile(filePath)
  } catch (err) {
    const message = err instanceof FileReadError ? err.message : `Unexpected error while opening:\n${filePath}`
    if (state?.dirty) {
      // Keep the editor (and its unsaved edits) intact; report the failure natively instead.
      await dialog.showMessageBox(win, { type: 'error', title: 'Unable to open the file', message, noLink: true })
      return
    }
    win.webContents.send('file:error', { path: filePath, message })
    return
  }

  if (!(await confirmDiscard(win))) return
  if (state) {
    state.currentPath = payload.path
    state.watcher.watchFile(payload.path)
    // Document outside the browsed tree: restart the explorer in its folder.
    const docDir = normalizeDir(dirname(payload.path))
    if (state.browseRoot && !isWithin(docDir, state.browseRoot)) state.browseRoot = null
  }
  syncAssetRoots()
  addRecentFile(payload.path)
  win.webContents.send('file:opened', { ...payload, dir: dirname(payload.path) })
}

async function reloadFile(win: BrowserWindow, filePath: string, external: boolean): Promise<void> {
  if (win.isDestroyed()) return
  if (!external && !(await confirmDiscard(win))) return
  try {
    const payload = await readOpenedFile(filePath)
    win.webContents.send(external ? 'file:changed' : 'file:opened', {
      ...payload,
      dir: dirname(payload.path)
    })
  } catch (err) {
    const message = err instanceof FileReadError ? err.message : `Error while reloading:\n${filePath}`
    win.webContents.send('file:error', { path: filePath, message, external })
  }
}

export async function reloadCurrent(win: BrowserWindow): Promise<void> {
  const path = currentPathOf(win)
  if (path) await reloadFile(win, path, false)
}

/**
 * Limits folder browsing to locations the user has reached by clicking: the
 * document folder, its tree, and the tree of the highest folder they moved up to
 * (the "browse root"). That enables sibling folders after moving up one level
 * without allowing the renderer to jump to an arbitrary disk path.
 */
function browseContext(win: BrowserWindow, dir: string): { target: string; docDir: string; root: string } | null {
  const current = currentPathOf(win)
  if (!current) return null
  const docDir = normalizeDir(dirname(current))
  return { target: normalizeDir(dir), docDir, root: states.get(win.id)?.browseRoot ?? docDir }
}

export function isBrowsableDir(win: BrowserWindow, dir: string): boolean {
  const ctx = browseContext(win, dir)
  return !!ctx && canBrowse(ctx.target, ctx.docDir, ctx.root)
}

/** Moves the browse root up when the user opens a folder above it. */
export function noteBrowsedDir(win: BrowserWindow, dir: string): void {
  const ctx = browseContext(win, dir)
  const state = states.get(win.id)
  if (!ctx || !state) return
  const next = nextBrowseRoot(ctx.target, ctx.root)
  if (next === state.browseRoot) return
  state.browseRoot = next
  // Browsing upward also expands the reachable image scope for documents.
  syncAssetRoots()
}

/** Excerpt from the open document, read in the main process for Copilot context. */
export async function readDocumentExcerpt(filePath: string, max = 8000): Promise<string | null> {
  if (!isMarkdownPath(filePath)) return null
  try {
    const { content } = await readMarkdownFile(filePath)
    return content.slice(0, max)
  } catch {
    return null
  }
}

export async function openFileDialog(win: BrowserWindow): Promise<void> {
  const result = await dialog.showOpenDialog(win, {
    title: 'Open file',
    properties: ['openFile'],
    filters: [
      { name: 'Markdown and images', extensions: [...MARKDOWN_EXTENSIONS, ...IMAGE_EXTENSIONS] },
      { name: 'Markdown', extensions: [...MARKDOWN_EXTENSIONS] },
      { name: 'Images', extensions: [...IMAGE_EXTENSIONS] },
      { name: 'All files', extensions: ['*'] }
    ]
  })
  if (result.canceled || result.filePaths.length === 0) return
  await openFileInWindow(win, result.filePaths[0]!)
}
