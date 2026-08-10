export interface Settings {
  theme: 'light' | 'dark' | 'system'
  zoom: number
  tocVisible: boolean
  tocWidth: number
  /** Fração vertical da barra lateral ocupada pelo sumário (0.15–0.85). */
  sidebarSplit: number
  readingWidth: 'comfortable' | 'full'
  loadRemoteImages: boolean
  recentFiles: string[]
  windowBounds: { x: number | null; y: number | null; width: number; height: number }
  windowMaximized: boolean
}

export interface FilePayload {
  path: string
  content: string
}

export interface FileErrorPayload {
  path: string
  message: string
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  zoom: 1,
  tocVisible: true,
  tocWidth: 300,
  sidebarSplit: 0.55,
  readingWidth: 'comfortable',
  loadRemoteImages: true,
  recentFiles: [],
  windowBounds: { x: null, y: null, width: 1280, height: 880 },
  windowMaximized: true
}

export const MIN_TOC_WIDTH = 180
export const MAX_TOC_WIDTH = 640
export const MIN_SIDEBAR_SPLIT = 0.15
export const MAX_SIDEBAR_SPLIT = 0.85

export const MAX_RECENT_FILES = 20

/** Acima disso o app avisa antes de abrir (Seção 8 da spec). */
export const LARGE_FILE_WARNING_BYTES = 20 * 1024 * 1024

export const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkd']
