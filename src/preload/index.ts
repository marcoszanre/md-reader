import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Settings } from '../shared/types'
import type {
  MdReaderAPI,
  OpenedPayload,
  ErrorPayload,
  CopilotAskInput,
  CopilotEvent,
  DirListing
} from '../shared/api'

const api: MdReaderAPI = {
  openFileDialog: () => ipcRenderer.invoke('file:openDialog'),
  openFile: (filePath: string) => ipcRenderer.invoke('file:open', filePath),
  reloadFile: () => ipcRenderer.invoke('file:reload'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  exportPdf: () => ipcRenderer.invoke('export:pdf'),
  print: () => ipcRenderer.invoke('window:print'),
  newWindow: () => ipcRenderer.invoke('window:new'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Partial<Settings>) => ipcRenderer.invoke('settings:set', patch),
  listDir: (dir: string): Promise<DirListing | null> => ipcRenderer.invoke('fs:list', dir),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  copilotAsk: (input: CopilotAskInput) => ipcRenderer.invoke('copilot:ask', input),
  copilotReset: () => ipcRenderer.invoke('copilot:reset'),
  onCopilotEvent: (cb: (event: CopilotEvent) => void) => {
    ipcRenderer.on('copilot:event', (_e, payload: CopilotEvent) => cb(payload))
  },
  onFileOpened: (cb: (payload: OpenedPayload) => void) => {
    ipcRenderer.on('file:opened', (_e, payload: OpenedPayload) => cb(payload))
  },
  onFileChanged: (cb: (payload: OpenedPayload) => void) => {
    ipcRenderer.on('file:changed', (_e, payload: OpenedPayload) => cb(payload))
  },
  onFileError: (cb: (payload: ErrorPayload) => void) => {
    ipcRenderer.on('file:error', (_e, payload: ErrorPayload) => cb(payload))
  }
}

contextBridge.exposeInMainWorld('mdreader', api)
