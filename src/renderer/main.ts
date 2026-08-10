import type { OpenedPayload, ErrorPayload, CopilotEvent, DirListing } from '../shared/api'
import type { Settings } from '../shared/types'
import { MIN_TOC_WIDTH, MAX_TOC_WIDTH, MIN_SIDEBAR_SPLIT, MAX_SIDEBAR_SPLIT } from '../shared/types'
import { renderMarkdown, type RenderResult } from './markdown/parser'
import { resolveLocalPath, isAbsoluteLocalPath } from './markdown/paths'
import { renderMermaidBlocks, cleanupStrays } from './markdown/mermaid'
import { ThemeController } from './ui/theme'
import { ZoomController } from './ui/zoom'
import { TocController } from './ui/toc'
import { SearchController } from './ui/search'

const api = window.mdreader

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Elemento ausente no HTML: ${id}`)
  return node as T
}

interface IdleWindow {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
}

/** Executa trabalho não crítico sem competir com a renderização. */
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

let settings: Settings | null = null
let currentDoc: { path: string; dir: string; source: string } | null = null
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
})

const zoom = new ZoomController((value) => {
  statusZoomEl.textContent = `${Math.round(value * 100)}%`
  void persist({ zoom: value })
})

const toc = new TocController(el<HTMLElement>('toc'), el<HTMLElement>('toc-list'), (id) => scrollToAnchor(id))

const search = new SearchController(
  contentEl,
  scrollerEl,
  searchBarEl,
  el<HTMLInputElement>('search-input'),
  el<HTMLElement>('search-count')
)

async function persist(patch: Partial<Settings>): Promise<void> {
  if (!settings) return
  settings = { ...settings, ...patch }
  await api.setSettings(patch)
}

function fileName(fullPath: string): string {
  return fullPath.split(/[\\/]/).pop() ?? fullPath
}

// ---------------------------------------------------------------- avisos

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

// ---------------------------------------------------------------- histórico

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

function goBack(): void {
  if (historyIndex <= 0) return
  historyIndex -= 1
  navigatingHistory = true
  void api.openFile(history[historyIndex]!)
  updateHistoryButtons()
}

function goForward(): void {
  if (historyIndex >= history.length - 1) return
  historyIndex += 1
  navigatingHistory = true
  void api.openFile(history[historyIndex]!)
  updateHistoryButtons()
}

// ---------------------------------------------------------------- explorador

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
    const empty = document.createElement('p')
    empty.className = 'toc-empty'
    empty.textContent = 'Não foi possível ler esta pasta.'
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
    empty.textContent = 'Nenhuma pasta ou arquivo .md aqui.'
    filesListEl.appendChild(empty)
    return
  }

  for (const entry of listing.entries) {
    const item = document.createElement('button')
    item.type = 'button'
    item.className = entry.isDirectory ? 'file-item is-dir' : 'file-item'
    item.dataset.path = entry.path
    item.title = entry.path
    item.textContent = `${entry.isDirectory ? '📁' : '📄'} ${entry.name}`
    item.addEventListener('click', () => {
      if (entry.isDirectory) void loadFolder(entry.path)
      else void api.openFile(entry.path)
    })
    filesListEl.appendChild(item)
  }
  markActiveFile()
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
  statusStatsEl.textContent = words ? `${words.toLocaleString('pt-BR')} palavras · ~${minutes} min de leitura` : ''
}

function renderFrontMatter(frontMatter: string | null): void {
  if (!frontMatter) return
  const details = document.createElement('details')
  details.className = 'front-matter'
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

async function renderDocument(payload: OpenedPayload, preserveScroll: boolean): Promise<void> {
  // Editores costumam salvar várias vezes: se o conteúdo não mudou, não re-renderiza.
  if (preserveScroll && currentDoc?.path === payload.path && currentDoc.source === payload.content) return

  const token = ++renderToken
  const previousScroll = scrollerEl.scrollTop
  const previousHeight = scrollerEl.scrollHeight

  const folderChanged = currentDoc?.dir !== payload.dir
  currentDoc = { path: payload.path, dir: payload.dir, source: payload.content }

  let result: RenderResult
  try {
    result = await renderMarkdown(payload.content, { docDir: payload.dir })
  } catch (err) {
    showError('Não foi possível renderizar o documento', err instanceof Error ? err.message : String(err))
    return
  }
  if (token !== renderToken) return

  emptyEl.hidden = true
  scrollerEl.hidden = false
  cleanupStrays()
  contentEl.innerHTML = result.html
  // Virtualização só compensa em documentos grandes; em textos curtos ela
  // atrapalharia a precisão do scroll e da busca.
  contentEl.classList.toggle('virtualized', contentEl.childElementCount > 400)
  renderFrontMatter(result.frontMatter)

  document.title = `${fileName(payload.path)} — MD Reader`
  titleNameEl.textContent = fileName(payload.path)
  titleNameEl.title = payload.path
  titleDirEl.textContent = payload.dir
  titleDirEl.title = payload.dir
  statusFileEl.textContent = payload.path
  statusFileEl.title = payload.path

  toc.render(result.headings)

  if (!preserveScroll) pushHistory(payload.path)
  if (folderChanged || !currentFolder) void loadFolder(payload.dir)
  else markActiveFile()

  // Trabalho não crítico sai do caminho da primeira pintura.
  whenIdle(() => {
    if (token !== renderToken) return
    updateStats()
    toc.observe(contentEl, scrollerEl)
    updateCopilotSuggestions()
  })

  if (result.hasRemoteImages && !allowRemoteImages) {
    showNotice('Imagens remotas foram bloqueadas para preservar sua privacidade.', {
      label: 'Carregar imagens',
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

  if (preserveScroll) {
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
  title.textContent = 'Recentes'
  recentListEl.appendChild(title)
  recent.slice(0, 8).forEach((file) => {
    const item = document.createElement('button')
    item.type = 'button'
    item.className = 'recent-item'
    item.textContent = fileName(file)
    item.title = file
    item.addEventListener('click', () => void api.openFile(file))
    recentListEl.appendChild(item)
  })
}

function handleContentClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
  if (!target) return

  const copy = target.closest<HTMLElement>('.copy-btn')
  if (copy) {
    const code = copy.parentElement?.querySelector('code')?.textContent ?? ''
    void navigator.clipboard.writeText(code).then(
      () => {
        copy.textContent = 'Copiado!'
        setTimeout(() => (copy.textContent = 'Copiar'), 1500)
      },
      () => {
        copy.textContent = 'Falhou'
        setTimeout(() => (copy.textContent = 'Copiar'), 1500)
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
  // Links vindos do documento só navegam para `.md` relativos à pasta atual:
  // caminhos absolutos ou de rede (UNC) são ignorados.
  if (currentDoc && /\.(md|markdown|mdown|mkd)(#.*)?$/i.test(href)) {
    if (isAbsoluteLocalPath(href) || /^[\\/]{2}/.test(href)) return
    void api.openFile(resolveLocalPath(currentDoc.dir, href))
  }
}

function showShortcuts(): void {
  const lines = [
    'Ctrl+O — Abrir',
    'Alt+← / Alt+→ — Voltar / avançar',
    'Ctrl+N — Nova janela',
    'Ctrl+W — Fechar janela',
    'Ctrl+F — Buscar',
    'Ctrl+P — Imprimir',
    'Ctrl+\\ — Painel lateral',
    'Ctrl+Shift+C — Copilot',
    'Ctrl+= / Ctrl+- / Ctrl+0 — Zoom',
    'Ctrl+Shift+T — Tema',
    'Ctrl+Shift+W — Largura',
    'F5 — Recarregar',
    'F11 — Tela cheia',
    'Esc — Fechar busca'
  ]
  showNotice(`Atalhos: ${lines.join(' · ')}`)
}

function applyWidth(width: Settings['readingWidth']): void {
  document.body.dataset.width = width
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
        'Resuma este documento em tópicos',
        'Quais são as ações pendentes e os próximos passos?',
        'Compare com os outros arquivos .md desta pasta'
      ]
    : ['O que você pode fazer aqui?', 'Como abro um arquivo?', 'Quais atalhos existem?']

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
  streamingBubble = addBubble('assistant', 'Pensando…')
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
      const line = addBubble('tool', `⚙ ${event.name ?? 'ferramenta'}`)
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
      addBubble('error', event.message ?? 'Erro no Copilot.')
      break
    }
  }
}

function wireCopilot(): void {
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

// ---------------------------------------------------------------- teclado / eventos

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

  // Clicar fora fecha a busca.
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
    if (path) void api.openFile(path)
  })
}

function wireKeyboard(): void {
  window.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null
    const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement

    if (event.key === 'Escape') {
      if (search.isOpen) search.close()
      else if (!copilotPanel.hidden) copilotOpen(false)
      return
    }

    if (event.altKey && event.key === 'ArrowLeft') {
      event.preventDefault()
      goBack()
      return
    }
    if (event.altKey && event.key === 'ArrowRight') {
      event.preventDefault()
      goForward()
      return
    }

    if (event.ctrlKey && !event.altKey) {
      const key = event.key.toLowerCase()
      if (handleZoomKey(event)) {
        event.preventDefault()
        return
      }
      if (event.shiftKey && key === 'c') {
        event.preventDefault()
        copilotOpen(copilotPanel.hidden)
        return
      }
      if (key === 'o') {
        event.preventDefault()
        void api.openFileDialog()
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
      if (key === 'p') {
        event.preventDefault()
        void api.print()
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
      if (event.shiftKey && key === 'w') {
        event.preventDefault()
        toggleWidth()
        return
      }
    }

    if (event.key === 'F5') {
      event.preventDefault()
      void api.reloadFile()
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

  // Botões laterais do mouse navegam no histórico.
  window.addEventListener('mouseup', (event) => {
    if (event.button === 3) goBack()
    if (event.button === 4) goForward()
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
  allowRemoteImages = settings.loadRemoteImages
  renderRecents(settings.recentFiles)
  updateHistoryButtons()

  el<HTMLElement>('empty-open').addEventListener('click', () => void api.openFileDialog())
  el<HTMLElement>('theme-toggle').addEventListener('click', () => theme.toggle())
  el<HTMLElement>('width-toggle').addEventListener('click', () => toggleWidth())
  el<HTMLElement>('zoom-in').addEventListener('click', () => zoom.in())
  el<HTMLElement>('zoom-out').addEventListener('click', () => zoom.out())
  el<HTMLElement>('status-zoom').addEventListener('click', () => zoom.reset())
  el<HTMLElement>('act-back').addEventListener('click', () => goBack())
  el<HTMLElement>('act-forward').addEventListener('click', () => goForward())
  el<HTMLElement>('act-open').addEventListener('click', () => void api.openFileDialog())
  el<HTMLElement>('act-reload').addEventListener('click', () => void api.reloadFile())
  el<HTMLElement>('act-toc').addEventListener('click', () => toggleToc())
  el<HTMLElement>('act-find').addEventListener('click', () => search.open())
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
  showSidePanel()

  api.onFileOpened((payload) => void renderDocument(payload, false))
  api.onFileChanged((payload) => void renderDocument(payload, true))
  api.onFileError((payload: ErrorPayload) => showError('Não foi possível abrir o arquivo', payload.message))
}

void bootstrap()
