import MarkdownIt from 'markdown-it'
import anchor from 'markdown-it-anchor'
import taskLists from 'markdown-it-task-lists'
import hljs from 'highlight.js/lib/common'
import { sanitizeHtml } from './sanitize'
import { resolveAssetUrl, isRemoteUrl } from './paths'

export interface Heading {
  level: number
  id: string
  title: string
}

export interface RenderResult {
  html: string
  headings: Heading[]
  frontMatter: string | null
  /** Number of source lines taken by the front matter (0 when there is none). */
  frontMatterLines: number
  /** Per-render token that authenticates `data-mdr-block` attributes; empty when `sourceMap` is off. */
  blockNonce: string
  hasMermaid: boolean
  hasMath: boolean
  hasRemoteImages: boolean
}

export interface RenderOptions {
  docDir: string
  /**
   * Tags every top-level block with `data-mdr-block="<nonce>:<startLine>:<endLine>"`
   * (0-based, end exclusive, relative to the full source) so it can be edited in place.
   */
  sourceMap?: boolean
}

/** Attribute that maps a rendered block back to its source lines. */
export const BLOCK_ATTR = 'data-mdr-block'

/** Self-contained block tokens whose renderers ignore token attributes; they get a balanced wrapper instead. */
const WRAPPED_BLOCK_RULES = ['math_block', 'math_block_eqno']

/** Class of the empty marker placed before raw HTML blocks (see `installSourceMap`). */
export const BLOCK_MARKER_CLASS = 'md-block-marker'

interface SourceMapEnv {
  sourceMap?: { nonce: string; offset: number }
}

function newNonce(): string {
  const bytes = new Uint8Array(8)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function installSourceMap(md: MarkdownIt): void {
  md.core.ruler.push('mdr_source_map', (state) => {
    const map = (state.env as SourceMapEnv | undefined)?.sourceMap
    if (!map) return
    const lines = state.src.split('\n')
    for (const token of state.tokens) {
      if (token.level !== 0 || !token.block || !token.map || token.nesting < 0) continue
      const start = token.map[0]
      let end = token.map[1]
      // Lists and some blocks include trailing blank lines; keep only the block's own lines.
      while (end > start + 1 && (lines[end - 1] ?? '').trim() === '') end -= 1
      token.attrSet(BLOCK_ATTR, `${map.nonce}:${start + map.offset}:${end + map.offset}`)
    }
  })

  for (const name of WRAPPED_BLOCK_RULES) {
    const original = md.renderer.rules[name]
    if (!original) continue
    md.renderer.rules[name] = (tokens, idx, options, env, self) => {
      const html = original(tokens, idx, options, env, self)
      const attr = tokens[idx]!.attrGet(BLOCK_ATTR)
      return attr ? `<div class="md-block" ${BLOCK_ATTR}="${escapeAttr(attr)}">${html}</div>` : html
    }
  }

  // Raw HTML is often opened in one block and closed in a later one (`<details>`,
  // `<div align="center">`), so wrapping it would close those elements early.
  // An empty marker in front of it carries the source range instead.
  const htmlBlock = md.renderer.rules.html_block
  md.renderer.rules.html_block = (tokens, idx, options, env, self) => {
    const html = htmlBlock ? htmlBlock(tokens, idx, options, env, self) : tokens[idx]!.content
    const attr = tokens[idx]!.attrGet(BLOCK_ATTR)
    return attr ? `<span class="${BLOCK_MARKER_CLASS}" hidden ${BLOCK_ATTR}="${escapeAttr(attr)}"></span>${html}` : html
  }
}

const FRONT_MATTER = /^\uFEFF?(?:---|\+\+\+)\r?\n([\s\S]*?)\r?\n(?:---|\+\+\+)(?:\r?\n|$)/

export function extractFrontMatter(source: string): { frontMatter: string | null; body: string } {
  const match = FRONT_MATTER.exec(source)
  if (!match) return { frontMatter: null, body: source }
  return { frontMatter: match[1] ?? '', body: source.slice(match[0].length) }
}

export function hasMathDelimiters(source: string): boolean {
  // Use indexOf instead of regex to avoid quadratic backtracking in large files
  // with unclosed `$$`.
  const block = source.indexOf('$$')
  if (block !== -1 && source.indexOf('$$', block + 2) !== -1) return true
  return /(^|[^\\$])\$[^\s$][^$\n]{0,200}\$/.test(source)
}

export function hasMermaidBlocks(source: string): boolean {
  return /^[ \t]*(?:```|~~~)\s*mermaid\s*$/m.test(source)
}

export function slugify(title: string): string {
  const base = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
  return base || 'section'
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

let basePromise: Promise<MarkdownIt> | null = null
let mathPromise: Promise<MarkdownIt> | null = null

function createBase(): MarkdownIt {
  const md: MarkdownIt = new MarkdownIt({
    html: true, // Safe only because output always passes through DOMPurify.
    linkify: true,
    breaks: false,
    typographer: false,
    highlight: (code, lang) => {
      const language = lang && hljs.getLanguage(lang) ? lang : ''
      try {
        const value = language ? hljs.highlight(code, { language }).value : md.utils.escapeHtml(code)
        return `<pre class="code-pre"><code class="hljs${language ? ` language-${language}` : ''}">${value}</code></pre>`
      } catch {
        return `<pre class="code-pre"><code class="hljs">${md.utils.escapeHtml(code)}</code></pre>`
      }
    }
  })

  md.use(anchor, {
    level: [1, 2, 3, 4, 5, 6],
    slugify,
    tabIndex: false,
    permalink: anchor.permalink.linkInsideHeader({ symbol: '#', placement: 'after', class: 'heading-anchor' })
  })
  md.use(taskLists, { label: true, labelAfter: true })

  const defaultFence = md.renderer.rules.fence
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!
    const info = token.info.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
    const blockAttr = token.attrGet(BLOCK_ATTR)
    const mapAttr = blockAttr ? ` ${BLOCK_ATTR}="${escapeAttr(blockAttr)}"` : ''
    if (info === 'mermaid') {
      return `<div class="mermaid-block"${mapAttr} data-mermaid="${escapeAttr(token.content)}"><div class="mermaid-render">Rendering diagram…</div></div>`
    }
    // The default fence renderer would copy the source-map attribute onto `<pre>`; the wrapper carries it instead.
    if (blockAttr) token.attrs = token.attrs?.filter(([name]) => name !== BLOCK_ATTR) ?? null
    const rendered = defaultFence
      ? defaultFence(tokens, idx, options, env, self)
      : `<pre class="code-pre"><code>${md.utils.escapeHtml(token.content)}</code></pre>`
    const label = info ? `<span class="code-lang">${md.utils.escapeHtml(info)}</span>` : ''
    return `<div class="code-block"${mapAttr}>${label}<span class="copy-btn" role="button" tabindex="0" title="Copy code">Copy</span>${rendered}</div>`
  }

  md.renderer.rules.image = (tokens, idx, _options, env: unknown) => {
    const token = tokens[idx]!
    const src = token.attrGet('src') ?? ''
    const alt = token.content ?? ''
    const title = token.attrGet('title')
    const docDir = (env as { docDir?: string } | undefined)?.docDir ?? ''
    const titleAttr = title ? ` title="${escapeAttr(title)}"` : ''

    if (/^https?:/i.test(src)) {
      return `<img class="remote-image" data-remote-src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"${titleAttr} />`
    }
    const resolved = isRemoteUrl(src) ? src : resolveAssetUrl(docDir, src)
    return `<img src="${escapeAttr(resolved)}" alt="${escapeAttr(alt)}"${titleAttr} loading="lazy" />`
  }

  return md
}

async function getParser(withMath: boolean): Promise<MarkdownIt> {
  if (!withMath) {
    basePromise ??= Promise.resolve(createBase()).then((md) => {
      installSourceMap(md)
      return md
    })
    return basePromise
  }
  mathPromise ??= (async () => {
    const md = createBase()
    // Load KaTeX only when the document has math (spec Section 9).
    const [{ default: katexPlugin }] = await Promise.all([
      import('@vscode/markdown-it-katex'),
      import('katex/dist/katex.min.css')
    ])
    md.use(katexPlugin, { throwOnError: false, errorColor: '#e5534b' })
    installSourceMap(md)
    return md
  })()
  return mathPromise
}

export async function renderMarkdown(source: string, options: RenderOptions): Promise<RenderResult> {
  const { frontMatter, body } = extractFrontMatter(source)
  const withMath = hasMathDelimiters(body)
  const md = await getParser(withMath)

  const prefix = source.slice(0, source.length - body.length)
  const offset = prefix.split('\n').length - 1
  const frontMatterLines = frontMatter === null ? 0 : prefix.endsWith('\n') ? offset : offset + 1
  const blockNonce = options.sourceMap ? newNonce() : ''

  const headings: Heading[] = []
  const env: { docDir: string; headings: Heading[] } & SourceMapEnv = {
    docDir: options.docDir,
    headings,
    ...(options.sourceMap ? { sourceMap: { nonce: blockNonce, offset } } : {})
  }

  const collector = md.renderer.rules.heading_open
  md.renderer.rules.heading_open = (tokens, idx, opts, envArg, self) => {
    const token = tokens[idx]!
    const id = token.attrGet('id')
    const inline = tokens[idx + 1]
    if (id && inline) {
      headings.push({ level: Number(token.tag.slice(1)), id, title: inline.content.replace(/\s*#\s*$/, '') })
    }
    return collector ? collector(tokens, idx, opts, envArg, self) : self.renderToken(tokens, idx, opts)
  }

  const rawHtml = md.render(body, env)
  md.renderer.rules.heading_open = collector

  return {
    html: sanitizeHtml(rawHtml),
    headings,
    frontMatter,
    frontMatterLines,
    blockNonce,
    hasMermaid: hasMermaidBlocks(body),
    hasMath: withMath,
    hasRemoteImages: /<img class="remote-image"/.test(rawHtml)
  }
}
