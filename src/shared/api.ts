import type { Settings } from './types'

export interface OpenedPayload {
  path: string
  content: string
  dir: string
}

export interface ErrorPayload {
  path: string
  message: string
}

export interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
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
