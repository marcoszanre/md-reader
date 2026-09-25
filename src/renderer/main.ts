import type { OpenedPayload, ErrorPayload, CopilotEvent, DirListing, DirEntry } from '../shared/api'
import type { Settings } from '../shared/types'
import {
  MIN_TOC_WIDTH,
  MAX_TOC_WIDTH,
  MIN_SIDEBAR_SPLIT,
  MAX_SIDEBAR_SPLIT,
  BINARY_EXTENSIONS,
  COPILOT_MODEL
} from '../shared/types'
import { renderMarkdown, BLOCK_ATTR, BLOCK_MARKER_CLASS, type RenderResult } from './markdown/parser'
import { renderTextView } from './markdown/text-view'
import { resolveLocalPath, isAbsoluteLocalPath, toAssetUrl } from './markdown/paths'
import { renderMermaidBlocks, cleanupStrays } from './markdown/mermaid'
import { ThemeController } from './ui/theme'
import { ZoomController } from './ui/zoom'
import { TocController } from './ui/toc'
import { SearchController } from './ui/search'
import { MinimapController } from './ui/minimap'

const api = window.mdreader

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing element in index.html: ${id}`)
  return node as T
}

interface IdleWindow {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
}

/** Runs non-critical work without competing with rendering. */
function whenIdle(fn: () => void): void {
  const ric = (window as unknown as IdleWindow).requestIdleCallback
  if (ric) ric(fn, { timeout: 500 })
  else setTimeout(fn, 0)
}

const contentEl = el<HTMLElement>('content')
const scrollerEl = el<HTMLElement>('scroller')
const emptyEl = el<HTMLElement>('empty-state')
const noticeEl = el<HTMLElement>('notice')
const statusFileEl = el<HTMLElement>('status-file')
const copyPathBtn = el<HTMLButtonElement>('act-copy-path')
const statusStatsEl = el<HTMLElement>('status-stats')
const statusZoomEl = el<HTMLElement>('status-zoom')
const dropOverlay = el<HTMLElement>('drop-overlay')
const recentListEl = el<HTMLElement>('recent-list')
const searchBarEl = el<HTMLElement>('search-bar')
const filesListEl = el<HTMLElement>('files-list')
const filesPathEl = el<HTMLElement>('files-path')
const backBtn = el<HTMLButtonElement>('act-back')
const forwardBtn = el<HTMLButtonElement>('act-forward')
const titleNameEl = el<HTMLElement>('titlebar-name')
const titleDirEl = el<HTMLElement>('titlebar-dir')
const sidebarEl = el<HTMLElement>('toc')
const tocSectionEl = el<HTMLElement>('panel-toc')

type DocKind = OpenedPayload['kind']

let settings: Settings | null = null
let currentDoc: {
  path: string
  dir: string
  source: string
  kind: DocKind
  mtimeMs?: number
  editable?: boolean
} | null = null
let allowRemoteImages = true
let renderToken = 0

const history: string[] = []
let historyIndex = -1
let navigatingHistory = false

let currentFolder: string | null = null

const theme = new ThemeController((mode) => {
  el<HTMLElement>('theme-toggle').textContent = mode === 'dark' ? '🌙' : mode === 'light' ? '☀' : '🖥'
  void persist({ theme: mode })
  if (currentDoc) void renderMermaidBlocks(contentEl, theme.isDark)
  minimap.refresh()
})

const zoom = new ZoomController((value) => {
  statusZoomEl.textContent = `${Math.round(value * 100)}%`
  void persist({ zoom: value })
})

const toc = new TocController(el<HTMLElement>('toc'), el<HTMLElement>('toc-list'), (id) => scrollToAnchor(id))

const minimap = new MinimapController(el<HTMLElement>('minimap'), scrollerEl, contentEl)
const minimapBtn = el<HTMLButtonElement>('minimap-toggle')

const search = new SearchController(
  contentEl,
  scrollerEl,
  searchBarEl,
  el<HTMLInputElement>('search-input'),
  el<HTMLElement>('search-count'),
  (matches, active) => minimap.setMarks(matches, active)
)

async function persist(patch: Partial<Settings>): Promise<void> {
  if (!settings) return
  settings = { ...settings, ...patch }
  await api.setSettings(patch)
}

function fileName(fullPath: string): string {
  return fullPath.split(/[\\/]/).pop() ?? fullPath
}

/** Links to known binary files are never opened in the viewer. */
const BINARY_LINK = new RegExp(`\\.(${BINARY_EXTENSIONS.join('|')})(#.*)?$`, 'i')

function isBinaryLink(href: string): boolean {
  return BINARY_LINK.test(href.split('?')[0] ?? href)
}

// ---------------------------------------------------------------- notices

function showNotice(message: string, action?: { label: string; run: () => void }): void {
  noticeEl.textContent = ''
  noticeEl.hidden = false
  const text = document.createElement('span')
  text.textContent = message
  noticeEl.appendChild(text)
  if (action) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = action.label
    button.addEventListener('click', action.run)
    noticeEl.appendChild(button)
  }
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'notice-close'
  close.textContent = '✕'
  close.addEventListener('click', () => {
    noticeEl.hidden = true
  })
  noticeEl.appendChild(close)
}

function showError(title: string, detail: string): void {
  minimap.setDocument(false)
  emptyEl.hidden = true
  scrollerEl.hidden = false
  contentEl.textContent = ''
  const box = document.createElement('div')
  box.className = 'error-box'
  const heading = document.createElement('h2')
  heading.textContent = title
  const pre = document.createElement('pre')
  pre.textContent = detail
  box.append(heading, pre)
  contentEl.appendChild(box)
  toc.render([])
  statusStatsEl.textContent = ''
}

// ---------------------------------------------------------------- history

function updateHistoryButtons(): void {
  backBtn.disabled = historyIndex <= 0
  forwardBtn.disabled = historyIndex < 0 || historyIndex >= history.length - 1
}

function pushHistory(path: string): void {
  if (navigatingHistory) {
    navigatingHistory = false
    updateHistoryButtons()
    return
  }
  if (history[historyIndex] === path) {
    updateHistoryButtons()
    return
  }
  history.splice(historyIndex + 1)
  history.push(path)
  historyIndex = history.length - 1
  updateHistoryButtons()
}

async function goBack(): Promise<void> {
  if (historyIndex <= 0 || !(await confirmLeaveEditor())) return
  historyIndex -= 1
  navigatingHistory = true
  void api.openFile(history[historyIndex]!)
  updateHistoryButtons()
}

async function goForward(): Promise<void> {
  if (historyIndex >= history.length - 1 || !(await confirmLeaveEditor())) return
  historyIndex += 1
  navigatingHistory = true
  void api.openFile(history[historyIndex]!)
  updateHistoryButtons()
}

// ---------------------------------------------------------------- file explorer

function markActiveFile(): void {
  const active = currentDoc?.path.toLowerCase()
  filesListEl.querySelectorAll<HTMLElement>('.file-item').forEach((item) => {
    item.classList.toggle('active', !!active && item.dataset.path?.toLowerCase() === active)
  })
}

async function loadFolder(dir: string): Promise<void> {
  const listing: DirListing | null = await api.listDir(dir)
  filesListEl.textContent = ''
  if (!listing) {
    // Keep the label consistent with the folder that failed, not the previous one.
    filesPathEl.textContent = fileName(dir) || dir
    filesPathEl.title = dir
    const empty = document.createElement('p')
    empty.className = 'toc-empty'
    empty.textContent = `Unable to read "${fileName(dir) || dir}".`
    filesListEl.appendChild(empty)
    return
  }

  currentFolder = listing.dir
  filesPathEl.textContent = fileName(listing.dir) || listing.dir
  filesPathEl.title = listing.dir
  el<HTMLButtonElement>('files-up').disabled = listing.parent === null

  if (listing.entries.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'toc-empty'
    empty.textContent = 'This folder is empty.'
    filesListEl.appendChild(empty)
    return
  }

  for (const entry of listing.entries) {
    // Binary files stay visible (but disabled) so the listing still reflects
    // the folder contents while browsing.
    const openable = entry.isDirectory || entry.kind !== 'binary'
    const item = document.createElement('button')
    item.type = 'button'
    item.className = entry.isDirectory ? 'file-item is-dir' : `file-item is-${entry.kind}`
    item.dataset.path = entry.path
    item.disabled = !openable
    item.title = openable ? entry.path : `${entry.path}\nBinary file: cannot be displayed`
    const icon = document.createElement('span')
    icon.className = 'file-icon'
    icon.textContent = fileIconFor(entry)
    const name = document.createElement('span')
    name.className = 'file-name'
    name.textContent = entry.name
    item.append(icon, name)
    if (openable) {
      item.addEventListener('click', () => {
        if (entry.isDirectory) void loadFolder(entry.path)
        else void openFileSafely(entry.path)
      })
    }
    filesListEl.appendChild(item)
  }
  markActiveFile()
}

function fileIconFor(entry: DirEntry): string {
  if (entry.isDirectory) return '📁'
  if (entry.kind === 'markdown') return '📄'
  if (entry.kind === 'image') return '🖼'
  if (entry.kind === 'text') return '📝'
  return '📦'
}

function showSidePanel(): void {
  if (!currentFolder && currentDoc) void loadFolder(currentDoc.dir)
}

function applySidebarSplit(fraction: number): void {
  const clamped = Math.min(MAX_SIDEBAR_SPLIT, Math.max(MIN_SIDEBAR_SPLIT, fraction))
  tocSectionEl.style.flex = `0 0 ${(clamped * 100).toFixed(1)}%`
}

// ---------------------------------------------------------------- render

function updateStats(): void {
  const text = contentEl.textContent ?? ''
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  const minutes = Math.max(1, Math.round(words / 200))
  statusStatsEl.textContent = words ? `${words.toLocaleString('en-US')} ${words === 1 ? 'word' : 'words'} · ~${minutes} min read` : ''
}

function renderFrontMatter(frontMatter: string | null, lines: number): void {
  if (!frontMatter) return
  const details = document.createElement('details')
  details.className = 'front-matter'
  details.setAttribute(BLOCK_ATTR, `${paintedNonce}:0:${lines}`)
  const summary = document.createElement('summary')
  summary.textContent = 'Front matter'
  const pre = document.createElement('pre')
  const code = document.createElement('code')
  code.textContent = frontMatter
  pre.appendChild(code)
  details.append(summary, pre)
  contentEl.prepend(details)
}

function applyRemoteImages(): void {
  contentEl.querySelectorAll<HTMLImageElement>('img.remote-image[data-remote-src]').forEach((img) => {
    const src = img.dataset.remoteSrc
    if (src) {
      img.src = src
      img.classList.remove('remote-image')
    }
  })
}

function updateDocumentChrome(payload: OpenedPayload): void {
  document.title = `${fileName(payload.path)} — MD Reader`
  titleNameEl.textContent = fileName(payload.path)
  titleNameEl.title = payload.path
  titleDirEl.textContent = payload.dir
  titleDirEl.title = payload.dir
  statusFileEl.textContent = payload.path
  statusFileEl.title = payload.path
  copyPathBtn.disabled = false
  updateEditControls()
}

/** Image viewer: the file is served through `mdasset://` and never travels over IPC. */
function renderImage(payload: OpenedPayload, preserveScroll: boolean): void {
  const token = ++renderToken
  const folderChanged = currentDoc?.dir !== payload.dir
  currentDoc = { path: payload.path, dir: payload.dir, source: '', kind: 'image', mtimeMs: payload.mtimeMs }

  emptyEl.hidden = true
  scrollerEl.hidden = false
  noticeEl.hidden = true
  cleanupStrays()
  contentEl.classList.remove('virtualized')
  contentEl.textContent = ''
  statusStatsEl.textContent = ''

  const name = fileName(payload.path)
  const figure = document.createElement('figure')
  figure.className = 'image-view'
  minimap.setDocument(false)
  const img = document.createElement('img')
  // The query suffix prevents the cache from showing a stale version after the file changes.
  img.src = `${toAssetUrl(payload.path)}?v=${Date.now()}`
  img.alt = name
  const caption = document.createElement('figcaption')
  caption.textContent = name
  img.addEventListener('load', () => {
    if (token !== renderToken) return
    const size = `${img.naturalWidth} × ${img.naturalHeight} px`
    statusStatsEl.textContent = size
    caption.textContent = `${name} · ${size}`
  })
  img.addEventListener('error', () => {
    if (token === renderToken) showError('Unable to display the image', payload.path)
  })
  figure.append(img, caption)
  contentEl.appendChild(figure)

  updateDocumentChrome(payload)
  toc.render([])
  if (!preserveScroll) {
    pushHistory(payload.path)
    scrollerEl.scrollTop = 0
  }
  if (folderChanged || !currentFolder) void loadFolder(payload.dir)
  else markActiveFile()
  search.refresh()
  whenIdle(() => {
    if (token === renderToken) updateCopilotSuggestions()
  })
}

/** Read-only text viewer, with syntax highlighting when possible. */
function renderText(payload: OpenedPayload, preserveScroll: boolean): void {
  const token = ++renderToken
  const previousScroll = scrollerEl.scrollTop
  if (preserveScroll && currentDoc?.path === payload.path && currentDoc.source === payload.content) return

  const folderChanged = currentDoc?.dir !== payload.dir
  currentDoc = { path: payload.path, dir: payload.dir, source: payload.content, kind: 'text', mtimeMs: payload.mtimeMs }

  emptyEl.hidden = true
  scrollerEl.hidden = false
  noticeEl.hidden = true
  cleanupStrays()
  contentEl.classList.remove('virtualized')

  const view = renderTextView(payload.content, payload.language ?? '')
  contentEl.innerHTML = view.html
  minimap.setDocument(true)

  const lines = `${view.lines.toLocaleString('en-US')} ${view.lines === 1 ? 'line' : 'lines'}`
  statusStatsEl.textContent = view.language ? `${lines} · ${view.language}` : `${lines} · plain text`

  updateDocumentChrome(payload)
  toc.render([])
  if (!preserveScroll) pushHistory(payload.path)
  if (folderChanged || !currentFolder) void loadFolder(payload.dir)
  else markActiveFile()
  scrollerEl.scrollTop = preserveScroll ? previousScroll : 0
  search.refresh()

  if (view.truncatedHighlight) {
    showNotice('Large file: syntax highlighting was turned off to keep scrolling smooth.')
  }
  whenIdle(() => {
    if (token === renderToken) updateCopilotSuggestions()
  })
}

async function renderDocument(payload: OpenedPayload, preserveScroll: boolean): Promise<void> {
  if (payload.kind === 'image') {
    renderImage(payload, preserveScroll)
    return
  }
  if (payload.kind === 'text') {
    renderText(payload, preserveScroll)
    return
  }

  // Editors often save several times in a row; skip re-rendering when nothing changed.
  if (preserveScroll && currentDoc?.path === payload.path && sameText(currentDoc.source, payload.content)) {
    currentDoc.mtimeMs = payload.mtimeMs
    return
  }

  const folderChanged = currentDoc?.dir !== payload.dir
  currentDoc = {
    path: payload.path,
    dir: payload.dir,
    source: payload.content,
    kind: 'markdown',
    mtimeMs: payload.mtimeMs,
    editable: payload.editable !== false
  }

  const painted = await paintMarkdown(payload.content, payload.dir, { preserveScroll })
  if (!painted) return

  updateDocumentChrome(payload)
  if (!preserveScroll) pushHistory(payload.path)
  if (folderChanged || !currentFolder) void loadFolder(payload.dir)
  else markActiveFile()
}

interface PaintOptions {
  preserveScroll: boolean
  /** Re-render after an inline edit: keep the exact scroll position and leave notices alone. */
  quiet?: boolean
}

/** Source-map token of the markdown currently on screen (see `BLOCK_ATTR`). */
let paintedNonce = ''

/** Renders Markdown into the reading pane. Shared by reading mode and inline editing. */
async function paintMarkdown(source: string, dir: string, options: PaintOptions): Promise<boolean> {
  const token = ++renderToken
  const previousScroll = scrollerEl.scrollTop
  const previousHeight = scrollerEl.scrollHeight

  let result: RenderResult
  try {
    result = await renderMarkdown(source, { docDir: dir, sourceMap: true })
  } catch (err) {
    if (!options.quiet) {
      showError('Unable to render the document', err instanceof Error ? err.message : String(err))
    }
    return false
  }
  if (token !== renderToken) return false

  emptyEl.hidden = true
  scrollerEl.hidden = false
  cleanupStrays()
  contentEl.innerHTML = result.html
  paintedNonce = result.blockNonce
  minimap.setDocument(true)
  // Virtualization only pays off for large documents; on short ones it would
  // reduce the precision of scrolling and search.
  contentEl.classList.toggle('virtualized', contentEl.childElementCount > 400)
  renderFrontMatter(result.frontMatter, result.frontMatterLines)
  if (editing) appendAddBlock()

  toc.render(result.headings)

  // Keep non-critical work off the first paint.
  whenIdle(() => {
    if (token !== renderToken) return
    updateStats()
    toc.observe(contentEl, scrollerEl)
    updateCopilotSuggestions()
  })

  if (options.quiet) {
    if (result.hasRemoteImages && allowRemoteImages) applyRemoteImages()
  } else if (result.hasRemoteImages && !allowRemoteImages) {
    showNotice('Remote images were blocked to protect your privacy.', {
      label: 'Load images',
      run: () => {
        allowRemoteImages = true
        void persist({ loadRemoteImages: true })
        applyRemoteImages()
        noticeEl.hidden = true
      }
    })
  } else {
    if (result.hasRemoteImages) applyRemoteImages()
    noticeEl.hidden = true
  }

  if (options.quiet) {
    scrollerEl.scrollTop = previousScroll
  } else if (options.preserveScroll) {
    requestAnimationFrame(() => {
      const ratio = previousHeight > 0 ? previousScroll / previousHeight : 0
      scrollerEl.scrollTop = Math.min(previousScroll, Math.round(ratio * scrollerEl.scrollHeight))
    })
  } else {
    scrollerEl.scrollTop = 0
  }

  search.refresh()

  if (result.hasMermaid) {
    void renderMermaidBlocks(contentEl, theme.isDark).then(() => {
      if (token === renderToken) updateStats()
    })
  }
  return true
}

function scrollToAnchor(id: string): void {
  const target = contentEl.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`)
  if (!target) return
  target.scrollIntoView({ block: 'start' })
  toc.setActive(id)
}

function renderRecents(recent: string[]): void {
  recentListEl.textContent = ''
  if (recent.length === 0) return
  const title = document.createElement('div')
  title.className = 'recent-title'
  title.textContent = 'Recent files'
  recentListEl.appendChild(title)
  recent.slice(0, 8).forEach((file) => {
    const item = document.createElement('button')
    item.type = 'button'
    item.className = 'recent-item'
    item.textContent = fileName(file)
    item.title = file
    item.addEventListener('click', () => void openFileSafely(file))
    recentListEl.appendChild(item)
  })
}

function handleContentClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
  if (!target) return

  // While editing, clicks open blocks instead; Ctrl+click still follows links.
  if (editing && !(event.ctrlKey && target.closest('a[href]'))) {
    if (target.closest('a[href]')) event.preventDefault()
    return
  }

  const copy = target.closest<HTMLElement>('.copy-btn')
  if (copy) {
    const code = copy.parentElement?.querySelector('code')?.textContent ?? ''
    void navigator.clipboard.writeText(code).then(
      () => {
        copy.textContent = 'Copied!'
        setTimeout(() => (copy.textContent = 'Copy'), 1500)
      },
      () => {
        copy.textContent = 'Failed'
        setTimeout(() => (copy.textContent = 'Copy'), 1500)
      }
    )
    return
  }

  const link = target.closest<HTMLAnchorElement>('a[href]')
  if (!link) return
  const href = link.getAttribute('href') ?? ''
  event.preventDefault()

  if (href.startsWith('#')) {
    scrollToAnchor(decodeURIComponent(href.slice(1)))
    return
  }
  if (/^(https?:|mailto:)/i.test(href)) {
    void api.openExternal(href)
    return
  }
  // Document links navigate to files relative to the current folder; the main
  // process refuses binaries. Absolute and network (UNC) paths are ignored.
  if (currentDoc && !isBinaryLink(href)) {
    if (isAbsoluteLocalPath(href) || /^[\\/]{2}/.test(href)) return
    void openFileSafely(resolveLocalPath(currentDoc.dir, href))
  }
}

let copyPathFeedback: number | null = null

async function copyCurrentPath(): Promise<void> {
  if (!currentDoc) return
  const copied = await api.copyCurrentPath()
  if (!copied) return
  copyPathBtn.classList.add('copied')
  copyPathBtn.textContent = '✓'
  if (copyPathFeedback !== null) window.clearTimeout(copyPathFeedback)
  copyPathFeedback = window.setTimeout(() => {
    copyPathBtn.classList.remove('copied')
    copyPathBtn.textContent = '⧉'
    copyPathFeedback = null
  }, 1400)
  showNotice(`Path copied: ${copied}`)
}

// ---------------------------------------------------------------- copy source / inline editing

const editBtn = el<HTMLButtonElement>('act-edit')
const copySourceBtn = el<HTMLButtonElement>('act-copy-source')
const statusEditEl = el<HTMLElement>('status-edit')

/** A block currently turned into editable source, in place of its rendered element. */
interface OpenBlock {
  /** Source line range being replaced (0-based, end exclusive). `start === end` inserts. */
  start: number
  end: number
  original: string
  /** Rendered element hidden while editing; `null` when adding a new block. */
  node: HTMLElement | null
  host: HTMLElement
  input: HTMLTextAreaElement
}

interface EditSession {
  path: string
  dir: string
  /** Document text as edited (LF line endings). */
  source: string
  /** Last text known to be on disk. `source !== disk` means a save is pending or failed. */
  disk: string
  /** `mtimeMs` of the on-disk version the edits are based on. */
  baseMtimeMs?: number
  block: OpenBlock | null
  undo: string[]
  redo: string[]
  saving: boolean
  saveFailed: boolean
  savedOnce: boolean
  saveChain: Promise<boolean>
  /** Newer version written by another program while there were unsaved edits. */
  external: OpenedPayload | null
}

const MAX_UNDO = 100

let editing: EditSession | null = null
let copySourceFeedback: number | null = null
let addBlockEl: HTMLButtonElement | null = null

/** Editing always works with LF; the main process restores the file's original line endings on save. */
function normalizeEol(text: string): string {
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text
}

function sameText(a: string, b: string): boolean {
  return a === b || normalizeEol(a) === normalizeEol(b)
}

function blockChanged(session: EditSession): boolean {
  return !!session.block && normalizeEol(session.block.input.value) !== session.block.original
}

function isDirty(session: EditSession | null): boolean {
  return !!session && (session.source !== session.disk || blockChanged(session))
}

let reportedDirty = false

/** Keeps the main process informed, so it can warn before closing, reloading or opening another file. */
function refreshDirty(): void {
  const dirty = isDirty(editing)
  if (dirty !== reportedDirty) {
    reportedDirty = dirty
    void api.setEditorDirty(dirty)
  }
  updateEditControls()
}

function updateEditControls(): void {
  const kind = currentDoc?.kind
  const canEdit = kind === 'markdown' && currentDoc?.editable !== false

  editBtn.disabled = !canEdit
  editBtn.textContent = editing ? '✓ Done' : '✎ Edit'
  editBtn.classList.toggle('accent', !!editing)
  editBtn.classList.toggle('active', !!editing)
  editBtn.setAttribute('aria-pressed', String(!!editing))
  editBtn.title = editing
    ? 'Finish editing (Ctrl+E)'
    : canEdit
      ? 'Edit this document in place (Ctrl+E)'
      : kind === 'markdown'
        ? 'This file is not UTF-8 encoded, so it stays read-only to protect its characters'
        : 'Only Markdown documents can be edited'

  if (copySourceFeedback === null) {
    copySourceBtn.textContent = kind === 'text' ? '📋 Copy text' : '📋 Copy Markdown'
  }
  copySourceBtn.disabled = kind !== 'markdown' && kind !== 'text'
  copySourceBtn.title =
    kind === 'text'
      ? 'Copy the full file content to the clipboard (Ctrl+Shift+M)'
      : 'Copy the full Markdown source to the clipboard (Ctrl+Shift+M)'

  const dirty = isDirty(editing)
  statusEditEl.hidden = !editing
  statusEditEl.classList.toggle('dirty', !!editing?.saveFailed)
  if (editing) {
    statusEditEl.textContent = editing.saving
      ? 'Saving…'
      : editing.saveFailed
        ? '● Not saved'
        : editing.block
          ? 'Click outside or press Esc to finish'
          : editing.savedOnce && !dirty
            ? '✓ Saved'
            : 'Click any block to edit'
  }

  titleNameEl.classList.toggle('dirty', dirty)
  if (currentDoc) document.title = `${dirty ? '● ' : ''}${fileName(currentDoc.path)} — MD Reader`
}

/** Full document text, including edits in a block that is still open. */
function currentText(): string {
  if (!currentDoc) return ''
  const session = editing
  if (!session) return currentDoc.source
  if (!session.block) return session.source
  return spliceBlock(session.source, session.block, normalizeEol(session.block.input.value)).text
}

async function copySource(): Promise<void> {
  if (!currentDoc || (currentDoc.kind !== 'markdown' && currentDoc.kind !== 'text')) return
  let label = '✓ Copied'
  try {
    await navigator.clipboard.writeText(currentText())
    copySourceBtn.classList.add('copied')
  } catch {
    label = '✕ Copy failed'
    showNotice('Unable to copy to the clipboard. Please try again.')
  }
  if (copySourceFeedback !== null) window.clearTimeout(copySourceFeedback)
  copySourceBtn.textContent = label
  copySourceFeedback = window.setTimeout(() => {
    copySourceFeedback = null
    copySourceBtn.classList.remove('copied')
    updateEditControls()
  }, 1400)
}

// -------------------------------------------------- source splicing

/** Replaces a block's lines with new text, keeping exactly one blank line between blocks. */
function spliceBlock(source: string, block: OpenBlock, value: string): { text: string; delta: number } {
  const lines = source.split('\n')
  let start = block.start
  let end = block.end
  let replacement = value.replace(/\s+$/, '') === '' ? [] : value.replace(/\n+$/, '').split('\n')

  if (!block.node) {
    // Appending: insert before the trailing newline and separate from the previous block.
    if (start > 0 && lines[start - 1] === '' && start === lines.length) start = end = start - 1
    if (replacement.length && start > 0 && (lines[start - 1] ?? '').trim() !== '') replacement = ['', ...replacement]
  } else if (replacement.length === 0) {
    // Removing a block: drop one adjacent blank line so gaps do not accumulate.
    if (end < lines.length && (lines[end] ?? '').trim() === '') end += 1
    else if (start > 0 && (lines[start - 1] ?? '').trim() === '') start -= 1
  }

  lines.splice(start, end - start, ...replacement)
  return { text: lines.join('\n'), delta: replacement.length - (end - start) }
}

function parseBlockAttr(node: Element): { start: number; end: number } | null {
  const [nonce, start, end] = (node.getAttribute(BLOCK_ATTR) ?? '').split(':')
  // Only attributes produced by this render are trusted; a document cannot forge them.
  if (!nonce || nonce !== paintedNonce) return null
  const s = Number(start)
  const e = Number(end)
  return Number.isInteger(s) && Number.isInteger(e) && s >= 0 && e >= s ? { start: s, end: e } : null
}

function blockAt(target: EventTarget | null): { node: HTMLElement; start: number; end: number } | null {
  if (!(target instanceof Element)) return null
  let node = target.closest<HTMLElement>(`[${BLOCK_ATTR}]`)
  while (node && contentEl.contains(node)) {
    const range = parseBlockAttr(node)
    if (range) return { node, ...range }
    node = node.parentElement?.closest<HTMLElement>(`[${BLOCK_ATTR}]`) ?? null
  }

  // Raw HTML blocks carry their range on an empty marker placed right before them.
  let top: Element | null = target
  while (top && top.parentElement !== contentEl) top = top.parentElement
  if (!(top instanceof HTMLElement)) return null
  for (let prev = top.previousElementSibling; prev; prev = prev.previousElementSibling) {
    if (!prev.hasAttribute(BLOCK_ATTR)) continue
    const range = prev.classList.contains(BLOCK_MARKER_CLASS) ? parseBlockAttr(prev) : null
    return range ? { node: top, ...range } : null
  }
  return null
}

// -------------------------------------------------- block editor

function kindClassFor(node: HTMLElement | null): string {
  if (!node) return 'is-text'
  const heading = /^H([1-6])$/.exec(node.tagName)
  if (heading) return `is-heading is-h${heading[1]}`
  if (
    node.matches('pre, details, .code-block, .mermaid-block, .md-block') ||
    node.querySelector(':scope > pre')
  ) {
    return 'is-code'
  }
  return 'is-text'
}

function autosize(input: HTMLTextAreaElement): void {
  input.style.height = 'auto'
  input.style.height = `${input.scrollHeight}px`
}

/** Estimates where the caret should go in the source, based on where the rendered text was clicked. */
function caretFromPoint(node: HTMLElement | null, source: string, x: number, y: number): number {
  if (!node) return source.length
  const hit = document.caretRangeFromPoint?.(x, y)
  if (!hit || !node.contains(hit.startContainer)) return source.length
  const before = document.createRange()
  before.selectNodeContents(node)
  before.setEnd(hit.startContainer, hit.startOffset)
  const renderedBefore = before.toString()
  const total = Math.max(1, (node.textContent ?? '').length)
  const estimate = Math.round((renderedBefore.length / total) * source.length)

  // Refine by locating the words right before the click in the source, nearest to the estimate.
  const snippet = renderedBefore.slice(-24).trimStart()
  if (snippet.length >= 2) {
    let best = -1
    for (let i = source.indexOf(snippet); i !== -1; i = source.indexOf(snippet, i + 1)) {
      if (best === -1 || Math.abs(i - estimate) < Math.abs(best - estimate)) best = i
    }
    if (best !== -1) return best + snippet.length
  }
  return Math.min(source.length, Math.max(0, estimate))
}

function openBlock(
  range: { node: HTMLElement | null; start: number; end: number },
  point?: { x: number; y: number }
): void {
  const session = editing
  if (!session || session.block) return
  const lines = session.source.split('\n')
  const original = range.node ? lines.slice(range.start, range.end).join('\n') : ''

  const host = document.createElement('div')
  host.className = `block-editor ${kindClassFor(range.node)}`
  const input = document.createElement('textarea')
  input.className = 'block-input'
  input.spellcheck = false
  input.rows = 1
  input.value = original
  input.setAttribute('aria-label', 'Markdown source of this block')
  input.placeholder = range.node ? '' : 'Type Markdown here…'
  host.appendChild(input)

  // Measure the click against the rendered text before it is replaced by the editor.
  const caret = point ? caretFromPoint(range.node, original, point.x, point.y) : original.length
  if (range.node) {
    range.node.after(host)
    range.node.hidden = true
  } else if (addBlockEl) {
    addBlockEl.before(host)
    addBlockEl.hidden = true
  } else {
    contentEl.appendChild(host)
  }

  session.block = { start: range.start, end: range.end, original, node: range.node, host, input }
  input.addEventListener('input', () => {
    autosize(input)
    refreshDirty()
  })
  input.addEventListener('keydown', handleBlockKeydown)

  autosize(input)
  input.focus({ preventScroll: true })
  input.setSelectionRange(caret, caret)
  updateEditControls()
}

/**
 * Applies the open block to the document, re-renders and saves.
 * Resolves to the change in line count, so callers can adjust ranges after it.
 */
async function commitBlock(): Promise<number> {
  const session = editing
  const block = session?.block
  if (!session || !block) return 0
  session.block = null

  const value = normalizeEol(block.input.value)
  if (value === block.original) {
    block.host.remove()
    if (block.node) block.node.hidden = false
    if (addBlockEl) addBlockEl.hidden = false
    refreshDirty()
    return 0
  }

  const { text, delta } = spliceBlock(session.source, block, value)
  pushUndo(session)
  session.source = text
  await applySource(session)
  return delta
}

function pushUndo(session: EditSession): void {
  session.undo.push(session.source)
  if (session.undo.length > MAX_UNDO) session.undo.shift()
  session.redo = []
}

async function undoRedo(direction: 'undo' | 'redo'): Promise<void> {
  const session = editing
  if (!session || session.block) return
  const from = direction === 'undo' ? session.undo : session.redo
  const to = direction === 'undo' ? session.redo : session.undo
  const previous = from.pop()
  if (previous === undefined) return
  to.push(session.source)
  session.source = previous
  await applySource(session)
}

/** Re-renders the edited document in place and saves it. */
async function applySource(session: EditSession): Promise<void> {
  if (currentDoc?.path === session.path) currentDoc.source = session.source
  refreshDirty()
  await paintMarkdown(session.source, session.dir, { preserveScroll: true, quiet: true })
  await saveNow()
}

/** Saves pending changes. Calls are serialized; resolves to `true` when the disk matches the document. */
function saveNow(): Promise<boolean> {
  const session = editing
  if (!session) return Promise.resolve(true)
  session.saveChain = session.saveChain.then(() => writeSession(session))
  return session.saveChain
}

async function writeSession(session: EditSession): Promise<boolean> {
  if (session.source === session.disk) return true
  const content = session.source
  session.saving = true
  updateEditControls()

  let result = await api.saveFile({ path: session.path, content, expectedMtimeMs: session.baseMtimeMs })
  // Only ask about overwriting while this session is still the one being edited.
  if (!result.ok && result.reason === 'conflict' && editing === session && (await api.confirmEditor('overwrite'))) {
    if (editing !== session) {
      session.saving = false
      return false
    }
    result = await api.saveFile({ path: session.path, content, force: true })
  }
  session.saving = false

  if (!result.ok) {
    session.saveFailed = true
    if (editing === session) {
      showNotice(
        result.reason === 'conflict'
          ? 'Your changes were not saved, and the version on disk was left untouched. Select Done to try again.'
          : result.message
      )
      refreshDirty()
    }
    return false
  }

  session.disk = content
  session.baseMtimeMs = result.mtimeMs
  session.external = null
  session.saveFailed = false
  session.savedOnce = true
  if (currentDoc?.path === session.path) currentDoc.mtimeMs = result.mtimeMs
  if (editing === session) refreshDirty()
  return session.source === session.disk
}

function appendAddBlock(): void {
  addBlockEl = document.createElement('button')
  addBlockEl.type = 'button'
  addBlockEl.className = 'block-add'
  addBlockEl.textContent = '+ Add a paragraph'
  addBlockEl.title = 'Add new content at the end of the document'
  contentEl.appendChild(addBlockEl)
}

// -------------------------------------------------- entering and leaving edit mode

function enterEditMode(): void {
  if (editing || !currentDoc || currentDoc.kind !== 'markdown' || currentDoc.editable === false) return
  const source = normalizeEol(currentDoc.source)
  editing = {
    path: currentDoc.path,
    dir: currentDoc.dir,
    source,
    disk: source,
    baseMtimeMs: currentDoc.mtimeMs,
    block: null,
    undo: [],
    redo: [],
    saving: false,
    saveFailed: false,
    savedOnce: false,
    saveChain: Promise.resolve(true),
    external: null
  }
  document.body.classList.add('editing')
  search.close()
  appendAddBlock()
  updateEditControls()
}

function exitEditMode(options: { discard?: boolean } = {}): void {
  if (!editing) return
  const session = editing
  editing = null
  session.block?.host.remove()
  if (session.block?.node) session.block.node.hidden = false
  addBlockEl?.remove()
  addBlockEl = null
  document.body.classList.remove('editing')

  // Discarded edits must not linger: restore the version that is on disk.
  if (options.discard && currentDoc?.path === session.path) {
    currentDoc.source = session.disk
    currentDoc.mtimeMs = session.baseMtimeMs
    if (session.source !== session.disk || session.block) {
      void paintMarkdown(session.disk, session.dir, { preserveScroll: true, quiet: true })
    }
  }
  refreshDirty()
  scrollerEl.focus({ preventScroll: true })
}

/** Commits the open block and waits for every pending save. Resolves to `true` when nothing is left unsaved. */
async function flushEdits(): Promise<boolean> {
  if (!editing) return true
  await commitBlock()
  await saveNow()
  return !isDirty(editing)
}

async function finishEditing(): Promise<void> {
  if (!editing) return
  if (!(await flushEdits())) return
  exitEditMode()
}

function toggleEditMode(): void {
  if (editing) void finishEditing()
  else enterEditMode()
}

/** History navigation moves the index before the file opens, so edits are settled up front. */
async function confirmLeaveEditor(): Promise<boolean> {
  if (!editing || (await flushEdits())) return true
  if (!(await api.confirmEditor('discard'))) return false
  exitEditMode({ discard: true })
  return true
}

/** Navigation started from the UI waits for pending saves, so it never races the editor. */
async function openFileSafely(filePath: string): Promise<void> {
  if (await confirmLeaveEditor()) await api.openFile(filePath)
}

async function openDialogSafely(): Promise<void> {
  if (await confirmLeaveEditor()) await api.openFileDialog()
}

async function reloadSafely(): Promise<void> {
  if (await confirmLeaveEditor()) await api.reloadFile()
}

/** Opens (or switches to) the block under the pointer. */
async function handleEditPointer(event: MouseEvent): Promise<void> {
  const session = editing
  if (!session || event.button !== 0) return
  const target = event.target as HTMLElement | null
  // Ignore the editor itself and the scroller's own scrollbar.
  if (!target || target === scrollerEl || session.block?.host.contains(target)) return

  const insideContent = contentEl.contains(target)
  const adding = !!addBlockEl && addBlockEl.contains(target)
  const range = adding ? null : insideContent ? blockAt(target) : null
  if (!session.block && !range && !adding) return

  // Ctrl+click keeps links working while editing.
  if (range && event.ctrlKey && target.closest('a[href]')) return

  if (insideContent) event.preventDefault()
  const openBefore = session.block
  const delta = await commitBlock()
  if (editing !== session) return

  if (adding) {
    const lines = session.source.split('\n')
    openBlock({ node: null, start: lines.length, end: lines.length })
    return
  }
  if (!range) return

  // After a commit the page was re-rendered: find the same block again, shifted by the edit.
  let { start, end } = range
  if (openBefore && start >= openBefore.end) {
    start += delta
    end += delta
  }
  const node =
    openBefore && openBefore.original !== normalizeEol(openBefore.input.value)
      ? contentEl.querySelector<HTMLElement>(`[${BLOCK_ATTR}="${paintedNonce}:${start}:${end}"]`)
      : range.node
  // A raw HTML block's range lives on its hidden marker; edit in place of the visible element.
  const visible = node?.classList.contains(BLOCK_MARKER_CLASS)
    ? ((node.nextElementSibling as HTMLElement | null) ?? node)
    : node
  if (visible) openBlock({ node: visible, start, end }, { x: event.clientX, y: event.clientY })
}

// -------------------------------------------------- external changes and file events

/** Another program changed the file while it is open in edit mode. */
function handleExternalChangeWhileEditing(session: EditSession, payload: OpenedPayload): void {
  const incoming = normalizeEol(payload.content)
  if (incoming === session.disk) {
    // The app's own save echoing back through the file watcher.
    session.baseMtimeMs = payload.mtimeMs
    if (currentDoc) currentDoc.mtimeMs = payload.mtimeMs
    return
  }

  if (!isDirty(session)) {
    // Nothing to lose: follow the file on disk.
    session.block?.host.remove()
    session.block = null
    session.source = session.disk = incoming
    session.baseMtimeMs = payload.mtimeMs
    session.undo = []
    session.redo = []
    if (currentDoc) {
      currentDoc.source = payload.content
      currentDoc.mtimeMs = payload.mtimeMs
    }
    void paintMarkdown(incoming, session.dir, { preserveScroll: true, quiet: true })
    return
  }

  session.external = payload
  showNotice('This file was changed by another program. Saving will ask before overwriting those changes.', {
    label: 'Discard my edits and reload',
    run: () => void discardAndReload()
  })
}

async function discardAndReload(): Promise<void> {
  const session = editing
  if (!session) return
  if (isDirty(session) && !(await api.confirmEditor('discard'))) return
  const external = session.external
  exitEditMode({ discard: true })
  noticeEl.hidden = true
  if (external) await renderDocument(external, true)
  else await api.reloadFile()
}

function handleFileChanged(payload: OpenedPayload): void {
  if (editing && payload.path === editing.path) {
    handleExternalChangeWhileEditing(editing, payload)
    return
  }
  void renderDocument(payload, true)
}

function handleFileOpened(payload: OpenedPayload): void {
  // The main process already confirmed with the user before discarding unsaved edits.
  exitEditMode({ discard: true })
  void renderDocument(payload, false)
}

function handleFileError(payload: ErrorPayload): void {
  if (editing && payload.external) {
    showNotice('The file is no longer available on disk. Your next edit will write it back to the same location.')
    return
  }
  exitEditMode({ discard: true })
  showError('Unable to open the file', payload.message)
}

// -------------------------------------------------- keyboard helpers inside a block

/** Inserts text through the browser's editing pipeline so that Ctrl+Z keeps working. */
function insertText(input: HTMLTextAreaElement, text: string): void {
  if (!document.execCommand('insertText', false, text)) {
    input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end')
    input.dispatchEvent(new Event('input'))
  }
}

function wrapSelection(input: HTMLTextAreaElement, marker: string): void {
  const { selectionStart: start, selectionEnd: end, value } = input
  const selected = value.slice(start, end)
  insertText(input, `${marker}${selected}${marker}`)
  input.setSelectionRange(start + marker.length, start + marker.length + selected.length)
}

const LIST_ITEM = /^(\s*)([-*+]|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?/

/** Enter inside a list item continues the list; Enter on an empty item ends it. */
function continueList(input: HTMLTextAreaElement): boolean {
  const { selectionStart: start, selectionEnd: end, value } = input
  if (start !== end) return false
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const line = value.slice(lineStart, start)
  const match = LIST_ITEM.exec(line)
  if (!match) return false

  if (line.length === match[0].length) {
    input.setSelectionRange(lineStart, start)
    insertText(input, '')
    return true
  }

  const [, indent = '', bullet = '', number, delimiter = '.', spacing = ' ', task] = match
  const nextBullet = number !== undefined ? `${Number(number) + 1}${delimiter}` : bullet
  insertText(input, `\n${indent}${nextBullet}${spacing}${task ? '[ ] ' : ''}`)
  return true
}

function handleBlockKeydown(event: KeyboardEvent): void {
  const input = event.currentTarget as HTMLTextAreaElement
  if (event.key === 'Escape' || (event.key === 'Enter' && event.ctrlKey)) {
    // Closing a block keeps its changes; Ctrl+Z restores the previous version.
    event.preventDefault()
    event.stopPropagation()
    void commitBlock()
    return
  }
  if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    event.preventDefault()
    insertText(input, '  ')
    return
  }
  if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && continueList(input)) {
    event.preventDefault()
    return
  }
  if (event.ctrlKey && !event.altKey && !event.shiftKey) {
    const key = event.key.toLowerCase()
    if (key === 'b') {
      event.preventDefault()
      wrapSelection(input, '**')
    } else if (key === 'i') {
      event.preventDefault()
      wrapSelection(input, '*')
    }
  }
}

function wireEditor(): void {
  editBtn.addEventListener('click', () => toggleEditMode())
  copySourceBtn.addEventListener('click', () => void copySource())
  // Capture phase: settle the open block before any other click handler runs.
  document.addEventListener('mousedown', (event) => void handleEditPointer(event), true)

  // Closing the window with unsaved edits: the main process asked the user and chose "Save".
  api.onSaveAndClose(() => {
    void (async () => {
      if (await flushEdits()) {
        exitEditMode()
        await api.closeWindow()
      }
    })()
  })
  updateEditControls()
}

function showShortcuts(): void {
  const lines = [
    'Ctrl+O — Open',
    'Alt+← / Alt+→ — Back / forward',
    'Ctrl+N — New window',
    'Ctrl+W — Close window',
    'Ctrl+F — Find',
    'Ctrl+E — Edit in place / done',
    'Ctrl+Z / Ctrl+Y — Undo / redo an edit',
    'Ctrl+P — Print',
    'Ctrl+Shift+M — Copy Markdown',
    'Ctrl+Shift+P — Copy file path',
    'Ctrl+\\ — Sidebar',
    'Ctrl+Shift+C — Copilot',
    'Ctrl+= / Ctrl+- / Ctrl+0 — Zoom',
    'Ctrl+Shift+T — Theme',
    'Ctrl+Shift+W — Reading width',
    'Ctrl+M — Minimap',
    'F5 — Reload',
    'F11 — Full screen',
    'Esc — Close search / finish editing'
  ]
  showNotice(`Shortcuts: ${lines.join(' · ')}`)
}

function applyWidth(width: Settings['readingWidth']): void {
  document.body.dataset.width = width
}

function applyMinimap(visible: boolean): void {
  minimap.setEnabled(visible)
  minimapBtn.classList.toggle('active', visible)
  minimapBtn.setAttribute('aria-pressed', String(visible))
}

function toggleMinimap(): void {
  const next = !minimap.isEnabled
  applyMinimap(next)
  void persist({ minimapVisible: next })
}

function toggleWidth(): void {
  const next = settings?.readingWidth === 'full' ? 'comfortable' : 'full'
  applyWidth(next)
  void persist({ readingWidth: next })
}

function toggleToc(): void {
  const next = !(settings?.tocVisible ?? true)
  toc.setVisible(next)
  void persist({ tocVisible: next })
}

// ---------------------------------------------------------------- copilot

const copilotPanel = el<HTMLElement>('copilot-panel')
const copilotMessages = el<HTMLElement>('copilot-messages')
const copilotSuggestions = el<HTMLElement>('copilot-suggestions')
const copilotPrompt = el<HTMLTextAreaElement>('copilot-prompt')

let streamingBubble: HTMLElement | null = null
let streamingText = ''
let copilotBusy = false

function copilotOpen(open: boolean): void {
  copilotPanel.hidden = !open
  document.body.classList.toggle('copilot-open', open)
  el<HTMLElement>('act-copilot').classList.toggle('active', open)
  if (open) copilotPrompt.focus()
}

function addBubble(role: 'user' | 'assistant' | 'tool' | 'error', text: string): HTMLElement {
  const bubble = document.createElement('div')
  bubble.className = `copilot-bubble ${role}`
  bubble.textContent = text
  copilotMessages.appendChild(bubble)
  copilotMessages.scrollTop = copilotMessages.scrollHeight
  return bubble
}

async function renderAssistantMarkdown(bubble: HTMLElement, text: string): Promise<void> {
  try {
    const result = await renderMarkdown(text, { docDir: currentDoc?.dir ?? '' })
    bubble.innerHTML = result.html
    bubble.classList.add('markdown-body', 'compact')
  } catch {
    bubble.textContent = text
  }
  copilotMessages.scrollTop = copilotMessages.scrollHeight
}

function updateCopilotSuggestions(): void {
  const suggestions = currentDoc
    ? [
        'Summarize this document as bullet points',
        'What are the open action items and next steps?',
        'Compare it with the other .md files in this folder'
      ]
    : ['What can you do here?', 'How do I open a file?', 'Which keyboard shortcuts are available?']

  copilotSuggestions.textContent = ''
  for (const text of suggestions) {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'copilot-chip'
    chip.textContent = text
    chip.addEventListener('click', () => void sendToCopilot(text))
    copilotSuggestions.appendChild(chip)
  }
}

async function sendToCopilot(prompt: string): Promise<void> {
  const text = prompt.trim()
  if (!text || copilotBusy) return
  copilotOpen(true)
  copilotBusy = true
  copilotPrompt.value = ''
  addBubble('user', text)
  streamingText = ''
  streamingBubble = addBubble('assistant', 'Thinking…')
  streamingBubble.classList.add('thinking')

  await api.copilotAsk({ prompt: text })
}

function handleCopilotEvent(event: CopilotEvent): void {
  switch (event.kind) {
    case 'delta': {
      if (!streamingBubble) streamingBubble = addBubble('assistant', '')
      streamingBubble.classList.remove('thinking')
      streamingText += event.text ?? ''
      streamingBubble.textContent = streamingText
      copilotMessages.scrollTop = copilotMessages.scrollHeight
      break
    }
    case 'message': {
      const full = event.text ?? streamingText
      const bubble = streamingBubble ?? addBubble('assistant', '')
      bubble.classList.remove('thinking')
      void renderAssistantMarkdown(bubble, full)
      streamingBubble = null
      streamingText = ''
      break
    }
    case 'tool': {
      const line = addBubble('tool', `⚙ ${event.name ?? 'tool'}`)
      line.classList.add('transient')
      break
    }
    case 'idle': {
      copilotBusy = false
      if (streamingBubble && streamingText) void renderAssistantMarkdown(streamingBubble, streamingText)
      streamingBubble = null
      streamingText = ''
      break
    }
    case 'error': {
      copilotBusy = false
      if (streamingBubble) streamingBubble.remove()
      streamingBubble = null
      addBubble('error', event.message ?? 'Copilot returned an error.')
      break
    }
  }
}

function wireCopilot(): void {
  el<HTMLElement>('copilot-model').textContent = COPILOT_MODEL
  el<HTMLElement>('act-copilot').addEventListener('click', () => copilotOpen(copilotPanel.hidden))
  el<HTMLElement>('copilot-close').addEventListener('click', () => copilotOpen(false))
  el<HTMLElement>('copilot-reset').addEventListener('click', () => {
    void api.copilotReset()
    copilotMessages.textContent = ''
    copilotBusy = false
    streamingBubble = null
    streamingText = ''
  })
  el<HTMLElement>('copilot-send').addEventListener('click', () => void sendToCopilot(copilotPrompt.value))
  copilotPrompt.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void sendToCopilot(copilotPrompt.value)
    }
  })
  api.onCopilotEvent(handleCopilotEvent)
  updateCopilotSuggestions()
}

// ---------------------------------------------------------------- keyboard / events

function handleZoomKey(event: KeyboardEvent): boolean {
  if (!event.ctrlKey) return false
  if (event.key === '=' || event.key === '+') {
    zoom.in()
    return true
  }
  if (event.key === '-' || event.key === '_') {
    zoom.out()
    return true
  }
  if (event.key === '0') {
    zoom.reset()
    return true
  }
  return false
}

function scrollBy(amount: number): void {
  scrollerEl.scrollBy({ top: amount, behavior: 'auto' })
}

function wireSearch(): void {
  const input = el<HTMLInputElement>('search-input')
  let debounce: number | undefined
  input.addEventListener('input', () => {
    window.clearTimeout(debounce)
    debounce = window.setTimeout(() => search.search(input.value), 120)
  })
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (event.shiftKey) search.previous()
      else search.next()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      search.close()
    }
  })
  el<HTMLElement>('search-next').addEventListener('click', () => search.next())
  el<HTMLElement>('search-prev').addEventListener('click', () => search.previous())
  el<HTMLElement>('search-close').addEventListener('click', () => search.close())

  // Clicking outside closes the search bar.
  document.addEventListener('mousedown', (event) => {
    if (!search.isOpen) return
    const target = event.target as HTMLElement | null
    if (!target) return
    if (searchBarEl.contains(target) || target.closest('#act-find')) return
    search.close()
  })
}

function wireDragAndDrop(): void {
  let depth = 0
  window.addEventListener('dragenter', (event) => {
    event.preventDefault()
    depth += 1
    dropOverlay.hidden = false
  })
  window.addEventListener('dragover', (event) => event.preventDefault())
  window.addEventListener('dragleave', (event) => {
    event.preventDefault()
    depth = Math.max(0, depth - 1)
    if (depth === 0) dropOverlay.hidden = true
  })
  window.addEventListener('drop', (event) => {
    event.preventDefault()
    depth = 0
    dropOverlay.hidden = true
    const file = event.dataTransfer?.files?.[0]
    if (!file) return
    const path = api.getPathForFile(file)
    if (path) void openFileSafely(path)
  })
}

function wireKeyboard(): void {
  window.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null
    const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement

    if (event.key === 'Escape') {
      if (search.isOpen) search.close()
      else if (!copilotPanel.hidden) copilotOpen(false)
      else if (editing) void finishEditing()
      return
    }

    if (event.altKey && event.key === 'ArrowLeft') {
      event.preventDefault()
      void goBack()
      return
    }
    if (event.altKey && event.key === 'ArrowRight') {
      event.preventDefault()
      void goForward()
      return
    }

    if (event.ctrlKey && !event.altKey) {
      const key = event.key.toLowerCase()
      if (handleZoomKey(event)) {
        event.preventDefault()
        return
      }
      if (key === 'e' && !event.shiftKey) {
        event.preventDefault()
        toggleEditMode()
        return
      }
      if (key === 's' && !event.shiftKey) {
        event.preventDefault()
        if (editing) void flushEdits()
        return
      }
      // Document-level undo/redo while editing; inside an open block the text box handles it natively.
      if (editing && !typing && (key === 'z' || key === 'y')) {
        event.preventDefault()
        void undoRedo(key === 'y' || event.shiftKey ? 'redo' : 'undo')
        return
      }
      if (event.shiftKey && key === 'm') {
        event.preventDefault()
        void copySource()
        return
      }
      if (event.shiftKey && key === 'c') {
        event.preventDefault()
        copilotOpen(copilotPanel.hidden)
        return
      }
      if (key === 'o') {
        event.preventDefault()
        void openDialogSafely()
        return
      }
      if (key === 'n') {
        event.preventDefault()
        void api.newWindow()
        return
      }
      if (key === 'w' && !event.shiftKey) {
        event.preventDefault()
        void api.closeWindow()
        return
      }
      if (key === 'f') {
        event.preventDefault()
        search.open()
        return
      }
      if (key === 'p' && !event.shiftKey) {
        event.preventDefault()
        void api.print()
        return
      }
      if (event.shiftKey && key === 'p') {
        event.preventDefault()
        void copyCurrentPath()
        return
      }
      if (key === '\\') {
        event.preventDefault()
        toggleToc()
        return
      }
      if (event.shiftKey && key === 't') {
        event.preventDefault()
        theme.toggle()
        return
      }
      if (key === 'm' && !event.shiftKey) {
        event.preventDefault()
        toggleMinimap()
        return
      }
      if (event.shiftKey && key === 'w') {
        event.preventDefault()
        toggleWidth()
        return
      }
    }

    if (event.key === 'F5') {
      event.preventDefault()
      void reloadSafely()
      return
    }
    if (event.key === 'F11') {
      event.preventDefault()
      void api.toggleFullscreen()
      return
    }

    if (typing || scrollerEl.hidden) return

    const page = scrollerEl.clientHeight * 0.9
    switch (event.key) {
      case 'PageDown':
        event.preventDefault()
        scrollBy(page)
        break
      case 'PageUp':
        event.preventDefault()
        scrollBy(-page)
        break
      case ' ':
        event.preventDefault()
        scrollBy(event.shiftKey ? -page : page)
        break
      case 'ArrowDown':
        event.preventDefault()
        scrollBy(80)
        break
      case 'ArrowUp':
        event.preventDefault()
        scrollBy(-80)
        break
      case 'Home':
        event.preventDefault()
        scrollerEl.scrollTo({ top: 0 })
        break
      case 'End':
        event.preventDefault()
        scrollerEl.scrollTo({ top: scrollerEl.scrollHeight })
        break
      default:
        break
    }
  })

  // Mouse side buttons navigate the history.
  window.addEventListener('mouseup', (event) => {
    if (event.button === 3) void goBack()
    if (event.button === 4) void goForward()
  })

  window.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey) return
      event.preventDefault()
      if (event.deltaY < 0) zoom.in()
      else zoom.out()
    },
    { passive: false }
  )
}

function applyTocWidth(width: number): void {
  const clamped = Math.min(MAX_TOC_WIDTH, Math.max(MIN_TOC_WIDTH, Math.round(width)))
  document.documentElement.style.setProperty('--toc-width', `${clamped}px`)
}

function wireTocResizer(): void {
  const resizer = el<HTMLElement>('toc-resizer')
  let dragging = false

  resizer.addEventListener('pointerdown', (event) => {
    dragging = true
    resizer.classList.add('dragging')
    resizer.setPointerCapture(event.pointerId)
    event.preventDefault()
  })
  resizer.addEventListener('pointermove', (event) => {
    if (dragging) applyTocWidth(event.clientX)
  })
  const stop = (event: PointerEvent): void => {
    if (!dragging) return
    dragging = false
    resizer.classList.remove('dragging')
    resizer.releasePointerCapture(event.pointerId)
    void persist({ tocWidth: Math.min(MAX_TOC_WIDTH, Math.max(MIN_TOC_WIDTH, Math.round(event.clientX))) })
  }
  resizer.addEventListener('pointerup', stop)
  resizer.addEventListener('pointercancel', stop)
}

function wireSidebarResizer(): void {
  const resizer = el<HTMLElement>('sidebar-resizer')
  let dragging = false

  const fractionFrom = (clientY: number): number => {
    const rect = sidebarEl.getBoundingClientRect()
    return (clientY - rect.top) / Math.max(1, rect.height)
  }

  resizer.addEventListener('pointerdown', (event) => {
    dragging = true
    resizer.classList.add('dragging')
    resizer.setPointerCapture(event.pointerId)
    event.preventDefault()
  })
  resizer.addEventListener('pointermove', (event) => {
    if (dragging) applySidebarSplit(fractionFrom(event.clientY))
  })
  const stop = (event: PointerEvent): void => {
    if (!dragging) return
    dragging = false
    resizer.classList.remove('dragging')
    resizer.releasePointerCapture(event.pointerId)
    const value = Math.min(MAX_SIDEBAR_SPLIT, Math.max(MIN_SIDEBAR_SPLIT, fractionFrom(event.clientY)))
    void persist({ sidebarSplit: Number(value.toFixed(3)) })
  }
  resizer.addEventListener('pointerup', stop)
  resizer.addEventListener('pointercancel', stop)
}

async function bootstrap(): Promise<void> {
  settings = await api.getSettings()
  theme.set(settings.theme)
  zoom.set(settings.zoom)
  toc.setVisible(settings.tocVisible)
  applyTocWidth(settings.tocWidth)
  applySidebarSplit(settings.sidebarSplit)
  applyWidth(settings.readingWidth)
  applyMinimap(settings.minimapVisible)
  allowRemoteImages = settings.loadRemoteImages
  renderRecents(settings.recentFiles)
  updateHistoryButtons()

  el<HTMLElement>('empty-open').addEventListener('click', () => void openDialogSafely())
  el<HTMLElement>('theme-toggle').addEventListener('click', () => theme.toggle())
  el<HTMLElement>('width-toggle').addEventListener('click', () => toggleWidth())
  minimapBtn.addEventListener('click', () => toggleMinimap())
  el<HTMLElement>('zoom-in').addEventListener('click', () => zoom.in())
  el<HTMLElement>('zoom-out').addEventListener('click', () => zoom.out())
  el<HTMLElement>('status-zoom').addEventListener('click', () => zoom.reset())
  el<HTMLElement>('act-back').addEventListener('click', () => void goBack())
  el<HTMLElement>('act-forward').addEventListener('click', () => void goForward())
  el<HTMLElement>('act-open').addEventListener('click', () => void openDialogSafely())
  el<HTMLElement>('act-reload').addEventListener('click', () => void reloadSafely())
  el<HTMLElement>('act-toc').addEventListener('click', () => toggleToc())
  el<HTMLElement>('act-find').addEventListener('click', () => search.open())
  copyPathBtn.addEventListener('click', () => void copyCurrentPath())
  el<HTMLElement>('act-help').addEventListener('click', () => showShortcuts())
  el<HTMLElement>('files-up').addEventListener('click', () => {
    if (currentFolder) {
      void api.listDir(currentFolder).then((listing) => {
        if (listing?.parent) void loadFolder(listing.parent)
      })
    }
  })
  contentEl.addEventListener('click', handleContentClick)

  wireSearch()
  wireDragAndDrop()
  wireKeyboard()
  wireTocResizer()
  wireSidebarResizer()
  wireCopilot()
  wireEditor()
  showSidePanel()

  api.onFileOpened(handleFileOpened)
  api.onFileChanged(handleFileChanged)
  api.onFileError(handleFileError)
}

void bootstrap()
