import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  writeMarkdownFile,
  detectTextFormat,
  encodeText,
  readMarkdownFile,
  FileWriteError
} from '../src/main/file-handler'

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mdreader-save-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('writeMarkdownFile', () => {
  it('saves content and reports the new modification time', async () => {
    const file = join(dir, 'note.md')
    await writeFile(file, '# Draft\n')
    const { mtimeMs } = await readMarkdownFile(file)

    const result = await writeMarkdownFile(file, '# Final\n', { expectedMtimeMs: mtimeMs })

    expect(await readFile(file, 'utf8')).toBe('# Final\n')
    expect(result.mtimeMs).toBe(Number((await stat(file)).mtimeMs))
  })

  it('leaves no temporary files behind', async () => {
    const file = join(dir, 'note.md')
    await writeFile(file, 'a')
    await writeMarkdownFile(file, 'b')
    expect(await readdir(dir)).toEqual(['note.md'])
  })

  it('preserves CRLF line endings and the UTF-8 BOM of the original file', async () => {
    const file = join(dir, 'windows.md')
    await writeFile(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('one\r\ntwo\r\n')]))

    await writeMarkdownFile(file, 'one\ntwo\nthree\n')

    const bytes = await readFile(file)
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(bytes.subarray(3).toString('utf8')).toBe('one\r\ntwo\r\nthree\r\n')
  })

  it('preserves UTF-16 LE encoding', async () => {
    const file = join(dir, 'utf16.md')
    await writeFile(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hello\n', 'utf16le')]))

    await writeMarkdownFile(file, 'café\n')

    const { content } = await readMarkdownFile(file)
    expect(content).toBe('café\n')
    expect(detectTextFormat(await readFile(file)).encoding).toBe('utf16le')
  })

  it('refuses to overwrite a file changed on disk unless forced', async () => {
    const file = join(dir, 'shared.md')
    await writeFile(file, 'original')
    const { mtimeMs } = await readMarkdownFile(file)
    const stale = mtimeMs - 60_000

    const attempt = writeMarkdownFile(file, 'mine', { expectedMtimeMs: stale })
    await expect(attempt).rejects.toBeInstanceOf(FileWriteError)
    await expect(writeMarkdownFile(file, 'mine', { expectedMtimeMs: stale })).rejects.toMatchObject({
      conflict: true
    })
    expect(await readFile(file, 'utf8')).toBe('original')

    await writeMarkdownFile(file, 'mine', { expectedMtimeMs: stale, force: true })
    expect(await readFile(file, 'utf8')).toBe('mine')
  })

  it('treats a file removed while editing as a conflict and recreates it when forced', async () => {
    const file = join(dir, 'gone.md')
    await writeFile(file, 'x')
    const { mtimeMs } = await readMarkdownFile(file)
    await rm(file)

    await expect(writeMarkdownFile(file, 'y', { expectedMtimeMs: mtimeMs })).rejects.toMatchObject({ conflict: true })
    await writeMarkdownFile(file, 'y', { expectedMtimeMs: mtimeMs, force: true })
    expect(await readFile(file, 'utf8')).toBe('y')
  })

  it('refuses to save over a file that is not valid UTF-8', async () => {
    const file = join(dir, 'legacy.md')
    const cp1252 = Buffer.from([0x4f, 0x6c, 0xe1, 0x0a]) // "Olá\n" in Windows-1252
    await writeFile(file, cp1252)

    expect((await readMarkdownFile(file)).editable).toBe(false)
    await expect(writeMarkdownFile(file, 'changed')).rejects.toThrow(/not UTF-8/)
    expect(await readFile(file)).toEqual(cp1252)
  })

  it('only writes Markdown documents', async () => {
    const file = join(dir, 'script.ps1')
    await writeFile(file, 'Write-Output 1')
    await expect(writeMarkdownFile(file, 'Remove-Item *')).rejects.toThrow(/Only Markdown/)
    expect(await readFile(file, 'utf8')).toBe('Write-Output 1')
  })
})

describe('encodeText', () => {
  it('normalizes mixed line endings to the target style', () => {
    expect(encodeText('a\r\nb\nc\rd', { encoding: 'utf8', eol: '\n' }).toString('utf8')).toBe('a\nb\nc\nd')
    expect(encodeText('a\nb', { encoding: 'utf8', eol: '\r\n' }).toString('utf8')).toBe('a\r\nb')
  })

  it('defaults to UTF-8 without BOM and LF for new files', () => {
    expect(detectTextFormat(null)).toEqual({ encoding: 'utf8', eol: '\n' })
  })
})
