import { describe, it, expect } from 'vitest'
import { renderMarkdown, extractFrontMatter, hasMathDelimiters, hasMermaidBlocks, slugify } from '../src/renderer/markdown/parser'
import { sanitizeSvg } from '../src/renderer/markdown/sanitize'

const opts = { docDir: 'C:/docs' }

describe('front matter', () => {
  it('separa o front matter do corpo', () => {
    const { frontMatter, body } = extractFrontMatter('---\ntitle: Teste\n---\n# Olá\n')
    expect(frontMatter).toBe('title: Teste')
    expect(body.trim()).toBe('# Olá')
  })

  it('documento sem front matter fica intacto', () => {
    const { frontMatter, body } = extractFrontMatter('# Olá\n\n---\n')
    expect(frontMatter).toBeNull()
    expect(body).toContain('# Olá')
  })
})

describe('detecção de recursos', () => {
  it('detecta matemática', () => {
    expect(hasMathDelimiters('a $x^2$ b')).toBe(true)
    expect(hasMathDelimiters('$$\nx\n$$')).toBe(true)
    expect(hasMathDelimiters('custa R$ 10 e R$ 20')).toBe(false)
  })

  it('detecta blocos mermaid', () => {
    expect(hasMermaidBlocks('```mermaid\ngraph TD;\n```')).toBe(true)
    expect(hasMermaidBlocks('```ts\nconst a = 1\n```')).toBe(false)
  })
})

describe('slugify', () => {
  it('remove acentos e pontuação', () => {
    expect(slugify('1. Objetivo — Ação!')).toBe('1-objetivo-acao')
  })
})

describe('render', () => {
  it('renderiza GFM: tabela, task list e strikethrough', async () => {
    const md = [
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '- [x] feito',
      '- [ ] pendente',
      '',
      '~~riscado~~'
    ].join('\n')
    const { html } = await renderMarkdown(md, opts)
    expect(html).toContain('<table>')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('<s>riscado</s>')
  })

  it('gera headings com id e coleta o sumário', async () => {
    const { html, headings } = await renderMarkdown('# Título Um\n\n## Sub Dois\n', opts)
    expect(html).toContain('id="titulo-um"')
    expect(headings.map((h) => [h.level, h.id])).toEqual([
      [1, 'titulo-um'],
      [2, 'sub-dois']
    ])
  })

  it('resolve imagem relativa para mdasset', async () => {
    const { html } = await renderMarkdown('![alt](img/foto.png)', opts)
    expect(html).toContain('mdasset://local/C%3A/docs/img/foto.png')
  })

  it('bloqueia imagem remota por padrão', async () => {
    const { html, hasRemoteImages } = await renderMarkdown('![alt](https://exemplo.com/a.png)', opts)
    expect(hasRemoteImages).toBe(true)
    expect(html).toContain('data-remote-src="https://exemplo.com/a.png"')
    expect(html).not.toMatch(/(^|\s)src="https:/)
  })

  it('transforma bloco mermaid em container próprio', async () => {
    const { html, hasMermaid } = await renderMarkdown('```mermaid\ngraph TD;\nA-->B;\n```', opts)
    expect(hasMermaid).toBe(true)
    expect(html).toContain('class="mermaid-block"')
  })

  it('adiciona botão de copiar em blocos de código', async () => {
    const { html } = await renderMarkdown('```ts\nconst a = 1\n```', opts)
    expect(html).toContain('copy-btn')
    expect(html).toContain('language-ts')
  })

  it('renderiza matemática com KaTeX', async () => {
    const { html, hasMath } = await renderMarkdown('$$x^2$$', opts)
    expect(hasMath).toBe(true)
    expect(html).toContain('katex')
  })
})

describe('sanitização (XSS)', () => {
  const payloads: [string, string][] = [
    ['script inline', '<script>alert(1)</script>'],
    ['img onerror', '<img src=x onerror=alert(1)>'],
    ['svg onload', '<svg onload=alert(1)></svg>'],
    ['iframe', '<iframe src="javascript:alert(1)"></iframe>'],
    ['link javascript', '[clique](javascript:alert(1))'],
    ['form', '<form action="http://mal.com"><input name="a"></form>'],
    ['style expression', '<style>body{background:url(javascript:alert(1))}</style>'],
    ['object', '<object data="data:text/html,<script>alert(1)</script>"></object>'],
    ['meta refresh', '<meta http-equiv="refresh" content="0;url=http://mal.com">'],
    ['base tag', '<base href="http://mal.com/">']
  ]

  for (const [name, payload] of payloads) {
    it(`neutraliza ${name}`, async () => {
      const { html } = await renderMarkdown(payload, opts)
      expect(html).not.toMatch(/<script/i)
      expect(html).not.toMatch(/onerror=/i)
      expect(html).not.toMatch(/onload=/i)
      expect(html).not.toMatch(/<iframe/i)
      expect(html).not.toMatch(/<object/i)
      expect(html).not.toMatch(/<form/i)
      expect(html).not.toMatch(/<base/i)
      expect(html).not.toMatch(/(href|src|action)\s*=\s*["']?\s*javascript:/i)
    })
  }

  it('mantém HTML benigno', async () => {
    const { html } = await renderMarkdown('<div class="x"><b>ok</b></div>', opts)
    expect(html).toContain('<b>ok</b>')
  })

  it('adiciona rel seguro em links externos', async () => {
    const { html } = await renderMarkdown('[site](https://exemplo.com)', opts)
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('remove src/href de rede (UNC e protocolo relativo)', async () => {
    const casos = [
      '<img src="//attacker.example/x.png">',
      '<img src="\\\\attacker.example\\share\\x.png">',
      '<a href="//attacker.example/share/x.md">link</a>'
    ]
    for (const caso of casos) {
      const { html } = await renderMarkdown(caso, opts)
      expect(html).not.toMatch(/(src|href)="[\\/]{2}/)
      expect(html).not.toContain('attacker.example')
    }
  })

  it('sanitizeSvg aplica a mesma política de sanitizeHtml', () => {
    const svg = sanitizeSvg('<svg><foreignObject><form action="http://mal"><button>x</button></form></foreignObject></svg>')
    expect(svg).not.toMatch(/<form/i)
    expect(svg).not.toMatch(/<button/i)
  })
})

describe('robustez', () => {
  it('documento vazio não quebra', async () => {
    const { html, headings } = await renderMarkdown('', opts)
    expect(html).toBe('')
    expect(headings).toEqual([])
  })

  it('só front matter', async () => {
    const { html, frontMatter } = await renderMarkdown('---\na: 1\n---\n', opts)
    expect(frontMatter).toBe('a: 1')
    expect(html.trim()).toBe('')
  })

  it('CRLF e CJK/emoji', async () => {
    const { html } = await renderMarkdown('# Título\r\n\r\n日本語 e emoji 🎉\r\n', opts)
    expect(html).toContain('日本語')
    expect(html).toContain('🎉')
  })

  it('documento grande renderiza rápido', async () => {
    const big = '## Seção\n\nTexto de exemplo com **negrito**.\n\n'.repeat(3000)
    const start = performance.now()
    const { headings } = await renderMarkdown(big, opts)
    expect(headings.length).toBe(3000)
    expect(performance.now() - start).toBeLessThan(8000)
  })

  it('detecção de matemática não sofre ReDoS com `$$` sem fechamento', () => {
    const evil = '$$' + 'a'.repeat(200000)
    const start = performance.now()
    expect(hasMathDelimiters(evil)).toBe(false)
    expect(performance.now() - start).toBeLessThan(500)
  })
})
