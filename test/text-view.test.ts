import { describe, it, expect } from 'vitest'
import { renderTextView, languageFor } from '../src/renderer/markdown/text-view'

describe('text-view', () => {
  it('maps extensions to highlight.js languages', () => {
    expect(languageFor('json')).toBe('json')
    expect(languageFor('HTML')).toBe('xml')
    expect(languageFor('ts')).toBe('typescript')
    expect(languageFor('yml')).toBe('yaml')
    expect(languageFor('made-up-extension')).toBeNull()
  })

  it('highlights JSON and counts lines', () => {
    const result = renderTextView('{\n  "a": 1\n}', 'json')
    expect(result.language).toBe('json')
    expect(result.lines).toBe(3)
    expect(result.html).toContain('hljs')
    expect(result.truncatedHighlight).toBe(false)
  })

  it('skips highlighting when the extension is unknown', () => {
    const result = renderTextView('line 1\nline 2', 'anything')
    expect(result.language).toBeNull()
    expect(result.lines).toBe(2)
    expect(result.html).toContain('line 1')
  })

  it('escapes file HTML instead of executing it', () => {
    const result = renderTextView('<script>alert(1)</script>', 'txt')
    expect(result.html).not.toContain('<script>')
    expect(result.html).toContain('alert(1)')
  })

  it('keeps HTML from an .html file visible as text', () => {
    const result = renderTextView('<h1>Hello</h1>', 'html')
    expect(result.language).toBe('xml')
    expect(result.html).not.toContain('<h1>')
    expect(result.html).toContain('Hello')
  })

  it('disables highlighting for very large files', () => {
    const result = renderTextView('{"a":1}\n'.repeat(80_000), 'json')
    expect(result.truncatedHighlight).toBe(true)
  })
})
