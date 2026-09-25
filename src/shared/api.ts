import type { Settings } from './types'

/** `binary` entries are listed in the explorer for orientation only; they cannot be opened. */
export type FileKind = 'directory' | 'markdown' | 'image' | 'text' | 'binary'

export interface OpenedPayload {
  path: string
  content: string
  dir: string
  kind: 'markdown' | 'image' | 'text'
  /** Suggested syntax-highlighting language when `kind` is `text`. */
  language?: string
  /** Last-modified time on disk; lets the editor detect external changes before saving. */
  mtimeMs?: number
  /** `false` when a Markdown file cannot be saved without losing data (e.g. not UTF-8). */
  editable?: boolean
}

export interface SaveRequest {
  /** Path the editor believes it is editing. The main process only accepts the window's current document. */
  path: string
  content: string
  /** `mtimeMs` of the version the edit started from. */
  expectedMtimeMs?: number
  /** Overwrite even if the file changed on disk since it was loaded. */
  force?: boolean
}

export type SaveResult =
  | { ok: true; mtimeMs: number }
  | { ok: false; reason: 'conflict' | 'stale' | 'invalid' | 'error'; message: string }

/** Confirmation prompts owned by the main process; the renderer only picks which one. */
export type EditorPrompt = 'discard' | 'overwrite'

export interface ErrorPayload {
  path: string
  message: string
  /** Raised by the file watcher (the file changed or disappeared), not by a user action. */
  external?: boolean
}

export interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
  kind: FileKind
}

export interface DirListing {
  dir: string
  parent: string | null
  entries: DirEntry[]
}

export interface CopilotAskInput {
  prompt: string
}

export interface CopilotEvent {
  kind: 'delta' | 'message' | 'tool' | 'idle' | 'error'
  text?: string
  name?: string
  message?: string
}

export interface MdReaderAPI {
  openFileDialog(): Promise<void>
  openFile(filePath: string): Promise<void>
  reloadFile(): Promise<void>
  openExternal(url: string): Promise<void>
  exportPdf(): Promise<string | null>
  print(): Promise<void>
  newWindow(): Promise<void>
  closeWindow(): Promise<void>
  toggleFullscreen(): Promise<void>
  copyCurrentPath(): Promise<string | null>
  saveFile(request: SaveRequest): Promise<SaveResult>
  setEditorDirty(dirty: boolean): Promise<void>
  confirmEditor(prompt: EditorPrompt): Promise<boolean>
  onSaveAndClose(cb: () => void): void
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  listDir(dir: string): Promise<DirListing | null>
  getPathForFile(file: File): string
  copilotAsk(input: CopilotAskInput): Promise<void>
  copilotReset(): Promise<void>
  onCopilotEvent(cb: (event: CopilotEvent) => void): void
  onFileOpened(cb: (payload: OpenedPayload) => void): void
  onFileChanged(cb: (payload: OpenedPayload) => void): void
  onFileError(cb: (payload: ErrorPayload) => void): void
}
