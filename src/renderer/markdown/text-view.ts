import hljs from 'highlight.js/lib/common'
import { sanitizeHtml } from './sanitize'
import { MAX_HIGHLIGHT_BYTES } from '../../shared/types'

/** File extension to a language known by highlight.js. */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescript',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  html: 'xml',
  htm: 'xml',
  xhtml: 'xml',
  vue: 'xml',
  svg: 'xml',
  xml: 'xml',
  xsd: 'xml',
  xsl: 'xml',
  csproj: 'xml',
  plist: 'xml',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  less: 'less',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  env: 'ini',
  properties: 'ini',
  py: 'python',
  pyw: 'python',
  rb: 'ruby',
  php: 'php',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  vb: 'vbnet',
  r: 'r',
  lua: 'lua',
  pl: 'perl',
  pm: 'perl',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  psm1: 'powershell',
  psd1: 'powershell',
  bat: 'dos',
  cmd: 'dos',
  sql: 'sql',
  kql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  diff: 'diff',
  patch: 'diff',
  makefile: 'makefile',
  mk: 'makefile',
  dockerfile: 'dockerfile',
  m: 'objectivec'
}

export interface TextViewResult {
  html: string
  lines: number
  language: string | null
  truncatedHighlight: boolean
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function languageFor(extension: string): string | null {
  const mapped = LANGUAGE_BY_EXTENSION[extension.toLowerCase()]
  if (!mapped) return null
  return hljs.getLanguage(mapped) ? mapped : null
}

/**
 * Renders a text file in read-only mode, with highlighting when the language is
 * known. Very large files skip highlighting to keep the interface responsive.
 */
export function renderTextView(content: string, extension: string): TextViewResult {
  const language = languageFor(extension)
  const tooBig = content.length > MAX_HIGHLIGHT_BYTES
  let body: string

  if (language && !tooBig) {
    try {
      body = hljs.highlight(content, { language }).value
    } catch {
      body = escapeHtml(content)
    }
  } else {
    body = escapeHtml(content)
  }

  const classes = ['hljs', 'text-view-code']
  if (language && !tooBig) classes.push(`language-${language}`)
  return {
    html: sanitizeHtml(`<pre class="code-pre text-view"><code class="${classes.join(' ')}">${body}</code></pre>`),
    lines: content ? content.split(/\r\n|\r|\n/).length : 0,
    language,
    truncatedHighlight: tooBig
  }
}
