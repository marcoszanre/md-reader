import { BrowserWindow, shell, dialog, app, nativeTheme, screen } from 'electron'
import { join, dirname, resolve, sep } from 'node:path'
import { FileWatcher, readMarkdownFile, FileReadError } from './file-handler'
import { getSettings, setSettings, addRecentFile } from './settings'
import { allowAssetRoot, setAssetRoots } from './protocol'
import { disposeWindow } from './copilot'
import type { Settings } from '../shared/types'

interface WindowState {
  watcher: FileWatcher
  currentPath: string | null
}

const states = new Map<number, WindowState>()

/** A allowlist de imagens contém apenas as pastas dos documentos abertos agora. */
function syncAssetRoots(): void {
  const dirs = [...states.values()]
    .map((state) => state.currentPath)
    .filter((path): path is string => !!path)
    .map((path) => dirname(path))
  setAssetRoots(dirs)
}

/** Cores dos controles nativos da janela, alinhadas ao tema do app. */
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
      // Plataforma sem overlay: ignorar.
    }
  }
}

/**
 * Mantém a janela no monitor onde ela estava. Se aquele monitor não existir mais
 * (ou a janela ficaria fora da área visível), reposiciona na área de trabalho
 * do display mais próximo.
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

/** Salva posição/tamanho "restaurados" e o estado maximizado da janela. */
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
    // Barra de título própria: o nome do arquivo precisa ser grande e legível.
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

  // Maximiza antes de exibir: a janela já aparece no monitor certo, sem piscar.
  if (settings.windowMaximized) win.maximize()

  const watcher = new FileWatcher((changed) => {
    void reloadFile(win, changed, true)
  })
  states.set(win.id, { watcher, currentPath: null })

  win.once('ready-to-show', () => win.show())

  // Salva o estado também durante o uso: se o app for encerrado pelo SO,
  // a última posição/monitor continua preservada.
  let saveTimer: NodeJS.Timeout | null = null
  const scheduleSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => persistWindowState(win), 400)
  }
  win.on('moved', scheduleSave)
  win.on('resized', scheduleSave)
  win.on('maximize', scheduleSave)
  win.on('unmaximize', scheduleSave)

  win.on('close', () => {
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
    // URL inválida: ignorar silenciosamente.
  }
}

export async function openFileInWindow(win: BrowserWindow, filePath: string): Promise<void> {
  try {
    const payload = await readMarkdownFile(filePath)
    const state = states.get(win.id)
    if (state) {
      state.currentPath = payload.path
      state.watcher.watchFile(payload.path)
    }
    allowAssetRoot(dirname(payload.path))
    addRecentFile(payload.path)
    win.webContents.send('file:opened', { ...payload, dir: dirname(payload.path) })
  } catch (err) {
    const message = err instanceof FileReadError ? err.message : `Erro inesperado ao abrir:\n${filePath}`
    win.webContents.send('file:error', { path: filePath, message })
  }
}

async function reloadFile(win: BrowserWindow, filePath: string, external: boolean): Promise<void> {
  if (win.isDestroyed()) return
  try {
    const payload = await readMarkdownFile(filePath)
    win.webContents.send(external ? 'file:changed' : 'file:opened', {
      ...payload,
      dir: dirname(payload.path)
    })
  } catch (err) {
    const message = err instanceof FileReadError ? err.message : `Erro ao recarregar:\n${filePath}`
    win.webContents.send('file:error', { path: filePath, message })
  }
}

export async function reloadCurrent(win: BrowserWindow): Promise<void> {
  const path = currentPathOf(win)
  if (path) await reloadFile(win, path, false)
}

/**
 * Limita a navegação de pastas ao contexto do documento aberto: a própria pasta,
 * seus ancestrais e descendentes. Evita que o renderer varra o disco inteiro.
 */
export function isBrowsableDir(win: BrowserWindow, dir: string): boolean {
  const current = currentPathOf(win)
  if (!current) return false
  const target = resolve(dir).toLowerCase()
  if (target.startsWith('\\\\')) return false

  const base = dirname(resolve(current)).toLowerCase()
  const withSep = (p: string): string => (p.endsWith(sep) ? p : p + sep)
  return target === base || target.startsWith(withSep(base)) || base.startsWith(withSep(target))
}

/** Trecho do documento aberto, lido no main para o contexto do Copilot. */
export async function readDocumentExcerpt(filePath: string, max = 8000): Promise<string | null> {
  try {
    const { content } = await readMarkdownFile(filePath)
    return content.slice(0, max)
  } catch {
    return null
  }
}

export async function openFileDialog(win: BrowserWindow): Promise<void> {
  const result = await dialog.showOpenDialog(win, {
    title: 'Abrir arquivo Markdown',
    properties: ['openFile'],
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
      { name: 'Todos os arquivos', extensions: ['*'] }
    ]
  })
  if (result.canceled || result.filePaths.length === 0) return
  await openFileInWindow(win, result.filePaths[0]!)
}
