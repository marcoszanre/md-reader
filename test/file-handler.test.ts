import { describe, it, expect } from 'vitest'
import {
  isMarkdownPath,
  isImagePath,
  isOpenablePath,
  fileKind,
  filePathFromArgv,
  readMarkdownFile,
  readOpenedFile,
  FileReadError
} from '../src/main/file-handler'
import { resolve } from 'node:path'

const fixture = resolve(__dirname, 'fixtures/basic.md')

describe('file-handler', () => {
  it('recognizes Markdown extensions', () => {
    expect(isMarkdownPath('a.md')).toBe(true)
    expect(isMarkdownPath('a.MARKDOWN')).toBe(true)
    expect(isMarkdownPath('a.mkd')).toBe(true)
    expect(isMarkdownPath('a.docx')).toBe(false)
  })

  it('recognizes image extensions', () => {
    expect(isImagePath('photo.PNG')).toBe(true)
    expect(isImagePath('icon.svg')).toBe(true)
    expect(isImagePath('a.md')).toBe(false)
  })

  it('classifies openable file types', () => {
    expect(fileKind('a.md')).toBe('markdown')
    expect(fileKind('photo.jpg')).toBe('image')
    expect(fileKind('data.json')).toBe('text')
    expect(fileKind('page.html')).toBe('text')
    expect(fileKind('script.js')).toBe('text')
    expect(fileKind('no-extension')).toBe('text')
    expect(fileKind('spreadsheet.xlsx')).toBe('binary')
    expect(fileKind('app.exe')).toBe('binary')
    expect(isOpenablePath('spreadsheet.xlsx')).toBe(false)
    expect(isOpenablePath('photo.webp')).toBe(true)
    expect(isOpenablePath('config.yaml')).toBe(true)
  })

  it('extracts the file from packaged argv', () => {
    expect(filePathFromArgv(['mdreader.exe', 'C:\\docs\\a.md'], true)).toBe(resolve('C:/docs/a.md'))
  })

  it('extracts the file from dev argv', () => {
    expect(filePathFromArgv(['electron', '.', 'C:\\docs\\a.md'], false)).toBe(resolve('C:/docs/a.md'))
  })

  it('accepts images and text in argv while ignoring flags and binaries', () => {
    expect(filePathFromArgv(['mdreader.exe', '--flag', 'photo.png'], true)).toBe(resolve('photo.png'))
    expect(filePathFromArgv(['mdreader.exe', '--flag', 'data.json'], true)).toBe(resolve('data.json'))
    expect(filePathFromArgv(['mdreader.exe', '--flag', 'spreadsheet.xlsx'], true)).toBeNull()
  })

  it('reads an existing file', async () => {
    const result = await readMarkdownFile(fixture)
    expect(result.content).toContain('# Basic document')
    expect(result.path).toBe(fixture)
  })

  it('readOpenedFile marks the type and rejects binaries', async () => {
    const opened = await readOpenedFile(fixture)
    expect(opened.kind).toBe('markdown')
    expect(opened.content).toContain('# Basic document')

    const text = await readOpenedFile(resolve(__dirname, '../package.json'))
    expect(text.kind).toBe('text')
    expect(text.language).toBe('json')
    expect(text.content).toContain('"name"')

    await expect(readOpenedFile(resolve(__dirname, 'fixtures/spreadsheet.xlsx'))).rejects.toThrow(/binary/)
  })

  it('returns an English error when the file does not exist', async () => {
    await expect(readMarkdownFile(resolve(__dirname, 'fixtures/missing.md'))).rejects.toBeInstanceOf(FileReadError)
    await expect(readMarkdownFile(resolve(__dirname, 'fixtures/missing.md'))).rejects.toThrow(
      /File not found/
    )
  })

  it('returns an error when pointing to a directory', async () => {
    await expect(readMarkdownFile(resolve(__dirname, 'fixtures'))).rejects.toThrow(/not a file/)
  })
})
