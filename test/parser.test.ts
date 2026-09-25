import { describe, it, expect } from 'vitest'
import { renderMarkdown, extractFrontMatter, hasMathDelimiters, hasMermaidBlocks, slugify } from '../src/renderer/markdown/parser'
import { sanitizeSvg } from '../src/renderer/markdown/sanitize'

const opts = { docDir: 'C:/docs' }

describe('front matter', () => {
  it('separates front matter from the body', () => {
    const { frontMatter, body } = extractFrontMatter('---\ntitle: Test\n---\n# Hello\n')
    expect(frontMatter).toBe('title: Test')
    expect(body.trim()).toBe('# Hello')
  })

  it('leaves a document without front matter intact', () => {
    const { frontMatter, body } = extractFrontMatter('# Hello\n\n---\n')
    expect(frontMatter).toBeNull()
    expect(body).toContain('# Hello')
  })
})

describe('feature detection', () => {
  it('detects math', () => {
    expect(hasMathDelimiters('a $x^2$ b')).toBe(true)
    expect(hasMathDelimiters('$$\nx\n$$')).toBe(true)
    expect(hasMathDelimiters('costs $ 10 and $ 20')).toBe(false)
  })

  it('detects Mermaid blocks', () => {
    expect(hasMermaidBlocks('```mermaid\ngraph TD;\n```')).toBe(true)
    expect(hasMermaidBlocks('```ts\nconst a = 1\n```')).toBe(false)
  })
})

describe('slugify', () => {
  it('removes accents and punctuation', () => {
    expect(slugify('1. Objective — Action!')).toBe('1-objective-action')
  })
})

describe('render', () => {
  it('renders GFM: table, task list, and strikethrough', async () => {
    const md = [
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '- [x] done',
      '- [ ] pending',
      '',
      '~~struck~~'
    ].join('\n')
    const { html } = await renderMarkdown(md, opts)
    expect(html).toContain('<table>')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('<s>struck</s>')
  })

  it('generates headings with ids and collects the table of contents', async () => {
    const { html, headings } = await renderMarkdown('# Title One\n\n## Sub Two\n', opts)
    expect(html).toContain('id="title-one"')
    expect(headings.map((h) => [h.level, h.id])).toEqual([
      [1, 'title-one'],
      [2, 'sub-two']
    ])
  })

  it('resolves a relative image to mdasset', async () => {
    const { html } = await renderMarkdown('![alt](img/photo.png)', opts)
    expect(html).toContain('mdasset://local/C%3A/docs/img/photo.png')
  })

  it('blocks remote images by default', async () => {
    const { html, hasRemoteImages } = await renderMarkdown('![alt](https://example.com/a.png)', opts)
    expect(hasRemoteImages).toBe(true)
    expect(html).toContain('data-remote-src="https://example.com/a.png"')
    expect(html).not.toMatch(/(^|\s)src="https:/)
  })

  it('turns a Mermaid block into its own container', async () => {
    const { html, hasMermaid } = await renderMarkdown('```mermaid\ngraph TD;\nA-->B;\n```', opts)
    expect(hasMermaid).toBe(true)
    expect(html).toContain('class="mermaid-block"')
  })

  it('adds a copy button to code blocks', async () => {
    const { html } = await renderMarkdown('```ts\nconst a = 1\n```', opts)
    expect(html).toContain('copy-btn')
    expect(html).toContain('language-ts')
  })

  it('renders math with KaTeX', async () => {
    const { html, hasMath } = await renderMarkdown('$$x^2$$', opts)
    expect(hasMath).toBe(true)
    expect(html).toContain('katex')
  })
})

describe('sanitization (XSS)', () => {
  const payloads: [string, string][] = [
    ['script inline', '<script>alert(1)</script>'],
    ['img onerror', '<img src=x onerror=alert(1)>'],
    ['svg onload', '<svg onload=alert(1)></svg>'],
    ['iframe', '<iframe src="javascript:alert(1)"></iframe>'],
    ['javascript link', '[click](javascript:alert(1))'],
    ['form', '<form action="http://mal.com"><input name="a"></form>'],
    ['style expression', '<style>body{background:url(javascript:alert(1))}</style>'],
    ['object', '<object data="data:text/html,<script>alert(1)</script>"></object>'],
    ['meta refresh', '<meta http-equiv="refresh" content="0;url=http://mal.com">'],
    ['base tag', '<base href="http://mal.com/">']
  ]

  for (const [name, payload] of payloads) {
    it(`neutralizes ${name}`, async () => {
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

  it('keeps benign HTML', async () => {
    const { html } = await renderMarkdown('<div class="x"><b>ok</b></div>', opts)
    expect(html).toContain('<b>ok</b>')
  })

  it('adds safe rel attributes to external links', async () => {
    const { html } = await renderMarkdown('[site](https://example.com)', opts)
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('removes network src/href values (UNC and protocol-relative)', async () => {
    const cases = [
      '<img src="//attacker.example/x.png">',
      '<img src="\\\\attacker.example\\share\\x.png">',
      '<a href="//attacker.example/share/x.md">link</a>'
    ]
    for (const sample of cases) {
      const { html } = await renderMarkdown(sample, opts)
      expect(html).not.toMatch(/(src|href)="[\\/]{2}/)
      expect(html).not.toContain('attacker.example')
    }
  })

  it('sanitizeSvg applies the same policy as sanitizeHtml', () => {
    const svg = sanitizeSvg('<svg><foreignObject><form action="http://mal"><button>x</button></form></foreignObject></svg>')
    expect(svg).not.toMatch(/<form/i)
    expect(svg).not.toMatch(/<button/i)
  })
})

describe('robustness', () => {
  it('does not fail on an empty document', async () => {
    const { html, headings } = await renderMarkdown('', opts)
    expect(html).toBe('')
    expect(headings).toEqual([])
  })

  it('handles front matter only', async () => {
    const { html, frontMatter } = await renderMarkdown('---\na: 1\n---\n', opts)
    expect(frontMatter).toBe('a: 1')
    expect(html.trim()).toBe('')
  })

  it('handles CRLF and CJK/emoji', async () => {
    const { html } = await renderMarkdown('# Title\r\n\r\n日本語 and emoji 🎉\r\n', opts)
    expect(html).toContain('日本語')
    expect(html).toContain('🎉')
  })

  it('renders a large document quickly', async () => {
    const big = '## Section\n\nSample text with **bold**.\n\n'.repeat(3000)
    const start = performance.now()
    const { headings } = await renderMarkdown(big, opts)
    expect(headings.length).toBe(3000)
    expect(performance.now() - start).toBeLessThan(8000)
  })

  it('math detection does not suffer ReDoS with unclosed `$$`', () => {
    const evil = '$$' + 'a'.repeat(200000)
    const start = performance.now()
    expect(hasMathDelimiters(evil)).toBe(false)
    expect(performance.now() - start).toBeLessThan(500)
  })
})
