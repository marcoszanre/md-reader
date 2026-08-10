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
  hasMermaid: boolean
  hasMath: boolean
  hasRemoteImages: boolean
}

export interface RenderOptions {
  docDir: string
}

const FRONT_MATTER = /^\uFEFF?(?:---|\+\+\+)\r?\n([\s\S]*?)\r?\n(?:---|\+\+\+)(?:\r?\n|$)/

export function extractFrontMatter(source: string): { frontMatter: string | null; body: string } {
  const match = FRONT_MATTER.exec(source)
  if (!match) return { frontMatter: null, body: source }
  return { frontMatter: match[1] ?? '', body: source.slice(match[0].length) }
}

export function hasMathDelimiters(source: string): boolean {
  // indexOf em vez de regex: evita backtracking quadrático em arquivos grandes
  // com `$$` sem fechamento.
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
  return base || 'secao'
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
    html: true, // seguro apenas porque a saída passa obrigatoriamente pelo DOMPurify
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
    if (info === 'mermaid') {
      return `<div class="mermaid-block" data-mermaid="${escapeAttr(token.content)}"><div class="mermaid-render">Renderizando diagrama…</div></div>`
    }
    const rendered = defaultFence
      ? defaultFence(tokens, idx, options, env, self)
      : `<pre class="code-pre"><code>${md.utils.escapeHtml(token.content)}</code></pre>`
    const label = info ? `<span class="code-lang">${md.utils.escapeHtml(info)}</span>` : ''
    return `<div class="code-block">${label}<span class="copy-btn" role="button" tabindex="0" title="Copiar código">Copiar</span>${rendered}</div>`
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
    basePromise ??= Promise.resolve(createBase())
    return basePromise
  }
  mathPromise ??= (async () => {
    const md = createBase()
    // KaTeX só é carregado quando o documento tem matemática (Seção 9 da spec).
    const [{ default: katexPlugin }] = await Promise.all([
      import('@vscode/markdown-it-katex'),
      import('katex/dist/katex.min.css')
    ])
    md.use(katexPlugin, { throwOnError: false, errorColor: '#e5534b' })
    return md
  })()
  return mathPromise
}

export async function renderMarkdown(source: string, options: RenderOptions): Promise<RenderResult> {
  const { frontMatter, body } = extractFrontMatter(source)
  const withMath = hasMathDelimiters(body)
  const md = await getParser(withMath)

  const headings: Heading[] = []
  const env = { docDir: options.docDir, headings }

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
    hasMermaid: hasMermaidBlocks(body),
    hasMath: withMath,
    hasRemoteImages: /<img class="remote-image"/.test(rawHtml)
  }
}
