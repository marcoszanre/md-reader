import { sanitizeSvg } from './sanitize'

type MermaidModule = typeof import('mermaid')['default']

let mermaidPromise: Promise<MermaidModule> | null = null
let counter = 0

async function getMermaid(dark: boolean): Promise<MermaidModule> {
  // Mermaid é pesado: só é importado quando o documento tem um bloco `mermaid`.
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
 * O Mermaid cria um elemento temporário no `body` para medir o diagrama e, em
 * caso de erro, pode deixá-lo para trás. Removemos qualquer resíduo.
 */
export function cleanupStrays(id?: string): void {
  if (id) document.getElementById(`d${id}`)?.remove()
  document.querySelectorAll('body > [id^="dmermaid-"], body > [id^="mermaid-"]').forEach((node) => node.remove())
}

/** Renderiza os diagramas de forma assíncrona; um diagrama quebrado não derruba a página. */
export async function renderMermaidBlocks(root: HTMLElement, dark: boolean): Promise<void> {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('.mermaid-block'))
  if (blocks.length === 0) return

  let mermaid: MermaidModule
  try {
    mermaid = await getMermaid(dark)
  } catch {
    for (const block of blocks) showFallback(block, 'Não foi possível carregar o Mermaid.')
    return
  }

  for (const block of blocks) {
    const source = block.dataset.mermaid ?? ''
    const target = block.querySelector<HTMLElement>('.mermaid-render')
    if (!target) continue
    const id = `mermaid-${++counter}`
    try {
      const { svg } = await mermaid.render(id, source)
      target.innerHTML = sanitizeSvg(svg)
      block.classList.add('mermaid-ok')
    } catch (err) {
      showFallback(block, err instanceof Error ? err.message : 'Diagrama inválido.')
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
  warning.textContent = `Diagrama Mermaid inválido: ${message}`
  const pre = document.createElement('pre')
  pre.className = 'code-pre'
  const code = document.createElement('code')
  code.textContent = block.dataset.mermaid ?? ''
  pre.appendChild(code)
  target.append(warning, pre)
}
