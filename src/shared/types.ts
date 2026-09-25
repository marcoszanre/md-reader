export interface Settings {
  theme: 'light' | 'dark' | 'system'
  zoom: number
  tocVisible: boolean
  minimapVisible: boolean
  tocWidth: number
  /** Vertical fraction of the sidebar taken by the table of contents (0.15–0.85). */
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
  minimapVisible: true,
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

/** Model used by the Copilot panel; the single source of truth for both processes. */
export const COPILOT_MODEL = 'claude-opus-5'

export const MAX_RECENT_FILES = 20

/** Files larger than this are refused to keep the app responsive (see section 8 of the spec). */
export const LARGE_FILE_WARNING_BYTES = 20 * 1024 * 1024

/** Upper bound for content saved from the editor; matches the read limit. */
export const MAX_SAVE_BYTES = LARGE_FILE_WARNING_BYTES

export const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkd']

/** Images the viewer opens directly (all safe to display inside `<img>`). */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico']

/**
 * Extensions known to carry binary content. Everything else is treated as text
 * and opened read-only; if a file still turns out to be binary, the reader
 * detects it and reports an error.
 */
export const BINARY_EXTENSIONS = [
  'exe', 'dll', 'sys', 'msi', 'bin', 'so', 'dylib', 'obj', 'lib', 'pdb', 'class', 'jar', 'wasm',
  'zip', 'rar', '7z', 'gz', 'tar', 'bz2', 'xz', 'cab', 'iso', 'dmg',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp',
  'mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'mp4', 'mkv', 'mov', 'avi', 'webm', 'wmv',
  'ttf', 'otf', 'woff', 'woff2', 'eot', 'psd', 'ai', 'sketch', 'blend',
  'db', 'sqlite', 'sqlite3', 'mdb', 'accdb', 'pyc', 'pyo'
]

/** Highlighting very large text is expensive; above this size it is turned off. */
export const MAX_HIGHLIGHT_BYTES = 512 * 1024
