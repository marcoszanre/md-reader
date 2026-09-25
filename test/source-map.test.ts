import { describe, it, expect } from 'vitest'
import { renderMarkdown, BLOCK_ATTR } from '../src/renderer/markdown/parser'

function blocks(html: string, nonce: string): Array<{ tag: string; start: number; end: number }> {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  return [...doc.body.querySelectorAll(`[${BLOCK_ATTR}]`)].map((node) => {
    const [token, start, end] = (node.getAttribute(BLOCK_ATTR) ?? '').split(':')
    expect(token).toBe(nonce)
    return { tag: node.tagName.toLowerCase(), start: Number(start), end: Number(end) }
  })
}

describe('source map for inline editing', () => {
  it('is off by default', async () => {
    const result = await renderMarkdown('# Title\n\nText', { docDir: '' })
    expect(result.blockNonce).toBe('')
    expect(result.html).not.toContain(BLOCK_ATTR)
  })

  it('maps every top-level block to its source lines', async () => {
    const source = ['# Title', '', 'Paragraph', 'continues', '', '- a', '- b', '', '```js', 'x()', '```', '', '---'].join('\n')
    const result = await renderMarkdown(source, { docDir: '', sourceMap: true })
    expect(result.blockNonce).toMatch(/^[0-9a-f]{16}$/)
    expect(blocks(result.html, result.blockNonce)).toEqual([
      { tag: 'h1', start: 0, end: 1 },
      { tag: 'p', start: 2, end: 4 },
      { tag: 'ul', start: 5, end: 7 },
      { tag: 'div', start: 8, end: 11 },
      { tag: 'hr', start: 12, end: 13 }
    ])
  })

  it('does not tag nested blocks', async () => {
    const result = await renderMarkdown('> quote\n>\n> - item\n', { docDir: '', sourceMap: true })
    expect(blocks(result.html, result.blockNonce)).toEqual([{ tag: 'blockquote', start: 0, end: 3 }])
  })

  it('offsets line numbers by the front matter', async () => {
    const source = '---\ntitle: x\n---\n# Title\n'
    const result = await renderMarkdown(source, { docDir: '', sourceMap: true })
    expect(result.frontMatterLines).toBe(3)
    expect(blocks(result.html, result.blockNonce)).toEqual([{ tag: 'h1', start: 3, end: 4 }])
  })

  it('marks raw HTML blocks without wrapping them', async () => {
    const result = await renderMarkdown('<div>raw</div>\n\ntext', { docDir: '', sourceMap: true })
    expect(blocks(result.html, result.blockNonce)[0]).toEqual({ tag: 'span', start: 0, end: 1 })
  })

  it('keeps HTML elements that span several Markdown blocks intact', async () => {
    const source = '<details><summary>More</summary>\n\nHidden **text**\n\n</details>\n\n<div align="center">\n\n![logo](logo.png)\n\n</div>\n'
    const result = await renderMarkdown(source, { docDir: '', sourceMap: true })
    const doc = new DOMParser().parseFromString(`<body>${result.html}</body>`, 'text/html')
    expect(doc.querySelector('details p')?.textContent).toBe('Hidden text')
    expect(doc.querySelector('div[align] img')).not.toBeNull()
  })

  it('uses a fresh nonce per render so documents cannot forge block mappings', async () => {
    const forged = `<p ${BLOCK_ATTR}="0000000000000000:0:99">x</p>`
    const a = await renderMarkdown(forged, { docDir: '', sourceMap: true })
    const b = await renderMarkdown(forged, { docDir: '', sourceMap: true })
    expect(a.blockNonce).not.toBe(b.blockNonce)
    expect(a.html).toContain(`${a.blockNonce}:0:1`)
  })
})
