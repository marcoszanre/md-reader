import { app, BrowserWindow, ipcMain, Menu, nativeTheme } from 'electron'
import { resolve, dirname } from 'node:path'
import { filePathFromArgv, isMarkdownPath } from './file-handler'
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
  readDocumentExcerpt,
  currentPathOf
} from './window'
import { ask as copilotAsk, reset as copilotReset } from './copilot'
import { listDirectory } from './fs-browser'
import type { Settings } from '../shared/types'

registerAssetScheme()

// Sem barra de menu: todos os comandos ficam na barra inferior do app.
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
  // Só o frame principal da própria janela pode acionar as ações do app.
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
    // O caminho vem de um link dentro de um `.md` não confiável: aceita apenas
    // arquivos Markdown locais e nunca caminhos de rede (evita auth SMB/NTLM).
    const full = resolve(filePath)
    if (full.startsWith('\\\\') || full.startsWith('//')) return
    if (!isMarkdownPath(full)) return
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
    // Só navega em pastas relacionadas ao documento aberto (a própria, ancestrais
    // e descendentes) — o renderer não pode varrer o disco.
    if (!isBrowsableDir(win, dir)) return null
    return await listDirectory(dir)
  })

  ipcMain.handle('copilot:ask', async (event, payload: unknown) => {
    const win = windowFrom(event)
    if (!win) return
    const input = (payload ?? {}) as { prompt?: unknown }
    if (typeof input.prompt !== 'string' || input.prompt.trim().length === 0) return

    // Arquivo, pasta e trecho vêm do estado do main — nunca do renderer.
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
