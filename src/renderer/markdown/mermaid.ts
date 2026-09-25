import { sanitizeSvg } from './sanitize'

type MermaidModule = typeof import('mermaid')['default']

let mermaidPromise: Promise<MermaidModule> | null = null
let counter = 0

async function getMermaid(dark: boolean): Promise<MermaidModule> {
  // Mermaid is heavy, so import it only when the document has a `mermaid` block.
  mermaidPromise ??= import('mermaid').then((mod) => mod.default)
  const mermaid = await mermaidPromise
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    theme: dark ? 'dark' : 'default',
    fontFamily: 'inherit'
  })
  return mermaid
}

/**
 * Mermaid creates a temporary element in `body` to measure the diagram and can
 * leave it behind on errors. Remove any residue.
 */
export function cleanupStrays(id?: string): void {
  if (id) document.getElementById(`d${id}`)?.remove()
  document.querySelectorAll('body > [id^="dmermaid-"], body > [id^="mermaid-"]').forEach((node) => node.remove())
}

/** Diagram source as stored by the parser (URI-encoded in `data-mermaid`). */
export function mermaidSource(block: HTMLElement): string {
  const raw = block.dataset.mermaid ?? ''
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/** Renders diagrams asynchronously; a broken diagram must not crash the page. */
export async function renderMermaidBlocks(root: HTMLElement, dark: boolean): Promise<void> {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('.mermaid-block'))
  if (blocks.length === 0) return

  let mermaid: MermaidModule
  try {
    mermaid = await getMermaid(dark)
  } catch {
    for (const block of blocks) showFallback(block, 'Could not load Mermaid.')
    return
  }

  for (const block of blocks) {
    const source = mermaidSource(block)
    const target = block.querySelector<HTMLElement>('.mermaid-render')
    if (!target) continue
    const id = `mermaid-${++counter}`
    try {
      const { svg } = await mermaid.render(id, source)
      target.innerHTML = sanitizeSvg(svg)
      block.classList.add('mermaid-ok')
    } catch (err) {
      showFallback(block, err instanceof Error ? err.message : 'Invalid diagram.')
    } finally {
      cleanupStrays(id)
    }
  }
}

function showFallback(block: HTMLElement, message: string): void {
  const target = block.querySelector<HTMLElement>('.mermaid-render')
  if (!target) return
  block.classList.add('mermaid-error')
  target.textContent = ''
  const warning = document.createElement('p')
  warning.className = 'mermaid-warning'
  warning.textContent = `Invalid Mermaid diagram: ${message}`
  const pre = document.createElement('pre')
  pre.className = 'code-pre'
  const code = document.createElement('code')
  code.textContent = mermaidSource(block)
  pre.appendChild(code)
  target.append(warning, pre)
}
