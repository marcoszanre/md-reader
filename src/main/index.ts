import { app, BrowserWindow, clipboard, ipcMain, Menu, nativeTheme } from 'electron'
import { resolve, dirname } from 'node:path'
import { filePathFromArgv, isOpenablePath } from './file-handler'
import { getSettings, setSettings } from './settings'
import { registerAssetScheme, handleAssetProtocol } from './protocol'
import { exportPdf } from './export'
import {
  createWindow,
  openFileDialog,
  openFileInWindow,
  openExternalSafely,
  reloadCurrent,
  applyTitleBarTheme,
  isBrowsableDir,
  noteBrowsedDir,
  readDocumentExcerpt,
  currentPathOf,
  saveCurrentDocument,
  setDirty as setEditorDirty,
  confirmDiscard,
  confirmOverwrite
} from './window'
import { ask as copilotAsk, reset as copilotReset } from './copilot'
import { listDirectory } from './fs-browser'
import type { Settings } from '../shared/types'
import { MAX_SAVE_BYTES } from '../shared/types'
import type { SaveRequest, SaveResult } from '../shared/api'

registerAssetScheme()

// No menu bar: every command is available from the app's bottom bar.
Menu.setApplicationMenu(null)

function applyNativeTheme(theme: Settings['theme']): void {
  nativeTheme.themeSource = theme
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const filePath = filePathFromArgv(argv, true)
    const existing = BrowserWindow.getAllWindows()[0]
    if (filePath) {
      createWindow(filePath)
    } else if (existing) {
      if (existing.isMinimized()) existing.restore()
      existing.focus()
    } else {
      createWindow(null)
    }
  })

  app.whenReady().then(() => {
    handleAssetProtocol()
    registerIpc()
    applyNativeTheme(getSettings().theme)
    createWindow(filePathFromArgv(process.argv, app.isPackaged))

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(null)
    })
  })

  app.on('window-all-closed', () => app.quit())

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
}

function windowFrom(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  const win = BrowserWindow.fromWebContents(event.sender)
  // Only the window's own main frame can trigger app actions.
  if (!win || event.senderFrame !== win.webContents.mainFrame) return null
  return win
}

function registerIpc(): void {
  ipcMain.handle('file:openDialog', async (event) => {
    const win = windowFrom(event)
    if (win) await openFileDialog(win)
  })

  ipcMain.handle('file:open', async (event, filePath: unknown) => {
    const win = windowFrom(event)
    if (!win || typeof filePath !== 'string') return
    // The path comes from a link inside an untrusted `.md`: accept only local
    // Markdown and images, never network paths (avoids SMB/NTLM authentication).
    const full = resolve(filePath)
    if (full.startsWith('\\\\') || full.startsWith('//')) return
    if (!isOpenablePath(full)) return
    await openFileInWindow(win, full)
  })

  ipcMain.handle('file:reload', async (event) => {
    const win = windowFrom(event)
    if (win) await reloadCurrent(win)
  })

  ipcMain.handle('shell:openExternal', async (_event, url: unknown) => {
    if (typeof url === 'string') await openExternalSafely(url)
  })

  ipcMain.handle('export:pdf', async (event) => {
    const win = windowFrom(event)
    return win ? await exportPdf(win) : null
  })

  ipcMain.handle('window:print', (event) => {
    windowFrom(event)?.webContents.print()
  })

  ipcMain.handle('window:new', () => {
    createWindow(null)
  })

  ipcMain.handle('window:close', (event) => {
    windowFrom(event)?.close()
  })

  ipcMain.handle('window:toggleFullscreen', (event) => {
    const win = windowFrom(event)
    if (win) win.setFullScreen(!win.isFullScreen())
  })

  // The copied path comes from main-process state, never renderer-provided text.
  ipcMain.handle('clipboard:copyPath', (event) => {
    const win = windowFrom(event)
    const filePath = win ? currentPathOf(win) : null
    if (filePath) clipboard.writeText(filePath)
    return filePath
  })

  // Saving only ever targets the window's current document; see `saveCurrentDocument`.
  ipcMain.handle('file:save', async (event, payload: unknown): Promise<SaveResult> => {
    const win = windowFrom(event)
    const input = (payload ?? {}) as Partial<SaveRequest>
    const valid =
      !!win &&
      typeof input.path === 'string' &&
      typeof input.content === 'string' &&
      (input.expectedMtimeMs === undefined || Number.isFinite(input.expectedMtimeMs)) &&
      (input.force === undefined || typeof input.force === 'boolean')
    if (!win || !valid) return { ok: false, reason: 'invalid', message: 'Invalid save request.' }
    if (Buffer.byteLength(input.content!, 'utf8') > MAX_SAVE_BYTES) {
      return { ok: false, reason: 'invalid', message: 'The document is too large to save. The limit is 20 MB.' }
    }
    return saveCurrentDocument(win, {
      path: input.path!,
      content: input.content!,
      expectedMtimeMs: input.expectedMtimeMs,
      force: input.force === true
    })
  })

  ipcMain.handle('editor:setDirty', (event, dirty: unknown) => {
    const win = windowFrom(event)
    if (win) setEditorDirty(win, dirty === true)
  })

  // The renderer picks which prompt to show; the wording always comes from the main process.
  ipcMain.handle('editor:confirm', async (event, prompt: unknown) => {
    const win = windowFrom(event)
    if (!win) return false
    if (prompt === 'discard') return confirmDiscard(win)
    if (prompt === 'overwrite') return confirmOverwrite(win)
    return false
  })

  ipcMain.handle('settings:get', () => getSettings())

  ipcMain.handle('settings:set', (_event, patch: unknown) => {
    const next = setSettings((patch ?? {}) as Partial<Settings>)
    applyNativeTheme(next.theme)
    applyTitleBarTheme(next.theme)
    return next
  })

  ipcMain.handle('fs:list', async (event, dir: unknown) => {
    const win = windowFrom(event)
    if (!win || typeof dir !== 'string' || !dir) return null
    // Only browse folders the user reached by clicking (the document tree and
    // the tree of the folder they moved up to); the renderer cannot scan disk.
    if (!isBrowsableDir(win, dir)) return null
    const listing = await listDirectory(dir)
    if (listing) noteBrowsedDir(win, dir)
    return listing
  })

  ipcMain.handle('copilot:ask', async (event, payload: unknown) => {
    const win = windowFrom(event)
    if (!win) return
    const input = (payload ?? {}) as { prompt?: unknown }
    if (typeof input.prompt !== 'string' || input.prompt.trim().length === 0) return

    // File, folder, and excerpt come from main-process state, never the renderer.
    const filePath = currentPathOf(win)
    const doc = filePath ? await readDocumentExcerpt(filePath) : null
    await copilotAsk(
      win,
      input.prompt,
      { filePath, dir: filePath ? dirname(filePath) : null },
      doc
    )
  })

  ipcMain.handle('copilot:reset', async (event) => {
    const win = windowFrom(event)
    if (win) await copilotReset(win)
  })
}
