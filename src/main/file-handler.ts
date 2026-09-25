import { watch, type FSWatcher } from 'node:fs'
import { readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { basename, dirname, join, resolve, extname } from 'node:path'
import {
  MARKDOWN_EXTENSIONS,
  IMAGE_EXTENSIONS,
  BINARY_EXTENSIONS,
  LARGE_FILE_WARNING_BYTES,
  MAX_SAVE_BYTES
} from '../shared/types'
import type { FileKind } from '../shared/api'

export class FileReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FileReadError'
  }
}

function decode(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le')
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2))
    swapped.swap16()
    return swapped.toString('utf16le')
  }
  let text = buffer.toString('utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  return text
}

export function isMarkdownPath(filePath: string): boolean {
  return MARKDOWN_EXTENSIONS.includes(extensionOf(filePath))
}

export function isImagePath(filePath: string): boolean {
  return IMAGE_EXTENSIONS.includes(extensionOf(filePath))
}

export function extensionOf(filePath: string): string {
  return extname(filePath).replace('.', '').toLowerCase()
}

/**
 * Classifies the file for the explorer. Anything that is not Markdown, an image,
 * or a known binary is treated as text and opened read-only.
 */
export function fileKind(filePath: string): FileKind {
  if (isMarkdownPath(filePath)) return 'markdown'
  if (isImagePath(filePath)) return 'image'
  if (BINARY_EXTENSIONS.includes(extensionOf(filePath))) return 'binary'
  return 'text'
}

export function isOpenablePath(filePath: string): boolean {
  return fileKind(filePath) !== 'binary'
}

/** Binary heuristic: null bytes or a high ratio of control characters. */
function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8000)
  if (sample.includes(0)) return true
  let control = 0
  for (const byte of sample) {
    if (byte < 9 || (byte > 13 && byte < 32)) control += 1
  }
  return sample.length > 0 && control / sample.length > 0.1
}

/** Converts common OS errors for every opened file into clear user-facing messages. */
async function statOrThrow(full: string): Promise<Awaited<ReturnType<typeof stat>>> {
  let info
  try {
    info = await stat(full)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') throw new FileReadError(`File not found:\n${full}`)
    if (code === 'EACCES' || code === 'EPERM') throw new FileReadError(`No permission to read the file:\n${full}`)
    throw new FileReadError(`Could not access the file:\n${full}`)
  }

  if (!info.isFile()) throw new FileReadError(`The path is not a file:\n${full}`)
  if (info.size > LARGE_FILE_WARNING_BYTES) {
    const mb = (info.size / (1024 * 1024)).toFixed(1)
    throw new FileReadError(
      `File is too large (${mb} MB). The safe opening limit is 20 MB:\n${full}`
    )
  }
  return info
}

/** Reads a `.md` file from disk and converts OS errors into user-facing messages. */
export async function readMarkdownFile(
  filePath: string
): Promise<{ path: string; content: string; mtimeMs: number; editable: boolean }> {
  const full = resolve(filePath)
  const info = await statOrThrow(full)

  try {
    const buffer = await readFile(full)
    return { path: full, content: decode(buffer), mtimeMs: Number(info.mtimeMs), editable: isSafelyEditable(buffer) }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EACCES' || code === 'EPERM') throw new FileReadError(`No permission to read the file:\n${full}`)
    throw new FileReadError(`Failed to read the file (invalid encoding or unavailable disk):\n${full}`)
  }
}

/**
 * Opens Markdown, images, or text (read-only). Images do not travel through IPC:
 * the renderer loads them through the `mdasset://` protocol, restricted to
 * folders related to the open document.
 */
export async function readOpenedFile(
  filePath: string
): Promise<{
  path: string
  content: string
  kind: 'markdown' | 'image' | 'text'
  language?: string
  mtimeMs: number
  editable?: boolean
}> {
  const full = resolve(filePath)
  const kind = fileKind(full)
  if (kind === 'binary') {
    throw new FileReadError(`This file is binary and cannot be displayed as text:\n${full}`)
  }
  if (kind === 'image') {
    const info = await statOrThrow(full)
    return { path: full, content: '', kind, mtimeMs: Number(info.mtimeMs) }
  }
  if (kind === 'markdown') {
    return { ...(await readMarkdownFile(full)), kind }
  }

  const info = await statOrThrow(full)
  let buffer: Buffer
  try {
    buffer = await readFile(full)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EACCES' || code === 'EPERM') throw new FileReadError(`No permission to read the file:\n${full}`)
    throw new FileReadError(`Failed to read the file:\n${full}`)
  }
  if (looksBinary(buffer)) {
    throw new FileReadError(`This file is binary and cannot be displayed as text:\n${full}`)
  }
  return {
    path: full,
    content: decode(buffer),
    kind: 'text',
    language: extensionOf(full),
    mtimeMs: Number(info.mtimeMs)
  }
}

export class FileWriteError extends Error {
  constructor(
    message: string,
    readonly conflict = false
  ) {
    super(message)
    this.name = 'FileWriteError'
  }
}

/**
 * Files without a BOM are decoded as UTF-8. When their bytes are not valid UTF-8
 * (for example, legacy Windows-1252 text), saving would permanently replace every
 * non-ASCII character, so such files are kept read-only.
 */
export function isSafelyEditable(buffer: Buffer): boolean {
  if (detectTextFormat(buffer).encoding !== 'utf8') return true
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return true
  } catch {
    return false
  }
}

export interface TextFormat {
  encoding: 'utf8' | 'utf8-bom' | 'utf16le' | 'utf16be'
  eol: '\n' | '\r\n'
}

/** Detects the encoding and line endings of an existing file so that saving preserves them. */
export function detectTextFormat(buffer: Buffer | null): TextFormat {
  if (!buffer || buffer.length === 0) return { encoding: 'utf8', eol: '\n' }
  let encoding: TextFormat['encoding'] = 'utf8'
  if (buffer[0] === 0xff && buffer[1] === 0xfe) encoding = 'utf16le'
  else if (buffer[0] === 0xfe && buffer[1] === 0xff) encoding = 'utf16be'
  else if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) encoding = 'utf8-bom'
  return { encoding, eol: decode(buffer).includes('\r\n') ? '\r\n' : '\n' }
}

export function encodeText(content: string, format: TextFormat): Buffer {
  const normalized = content.replace(/\r\n?/g, '\n')
  const text = format.eol === '\r\n' ? normalized.replace(/\n/g, '\r\n') : normalized
  switch (format.encoding) {
    case 'utf8-bom':
      return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')])
    case 'utf16le':
      return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
    case 'utf16be': {
      const body = Buffer.from(text, 'utf16le')
      body.swap16()
      return Buffer.concat([Buffer.from([0xfe, 0xff]), body])
    }
    default:
      return Buffer.from(text, 'utf8')
  }
}

export interface WriteOptions {
  /** `mtimeMs` of the version the edit started from; a different value on disk means a conflict. */
  expectedMtimeMs?: number
  /** Overwrite even when the file changed on disk. */
  force?: boolean
}

/**
 * Saves a Markdown document atomically: the content is written to a temporary
 * file in the same folder and then renamed over the original, so a crash or a
 * full disk never leaves a half-written document behind. Encoding, BOM and line
 * endings of the existing file are preserved, and symbolic links are resolved
 * so the link itself is not replaced.
 */
export async function writeMarkdownFile(
  filePath: string,
  content: string,
  options: WriteOptions = {}
): Promise<{ path: string; mtimeMs: number }> {
  const full = resolve(filePath)
  if (!isMarkdownPath(full)) throw new FileWriteError(`Only Markdown documents can be saved:\n${full}`)
  if (Buffer.byteLength(content, 'utf8') > MAX_SAVE_BYTES) {
    throw new FileWriteError('The document is too large to save. The limit is 20 MB.')
  }

  let target = full
  let existing: Buffer | null = null
  let diskMtimeMs: number | null = null
  try {
    target = await realpath(full)
    const info = await stat(target)
    if (!info.isFile()) throw new FileWriteError(`The path is not a file:\n${full}`)
    diskMtimeMs = Number(info.mtimeMs)
    existing = await readFile(target)
  } catch (err) {
    if (err instanceof FileWriteError) throw err
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EACCES' || code === 'EPERM') throw new FileWriteError(`No permission to access the file:\n${full}`)
    // ENOENT: the file was removed while editing; saving recreates it in place.
    if (code !== 'ENOENT') throw new FileWriteError(`Could not access the file:\n${full}`)
  }

  const expected = options.expectedMtimeMs
  if (existing && !isSafelyEditable(existing)) {
    throw new FileWriteError(
      `This file is not UTF-8 encoded. To avoid corrupting its characters, it cannot be edited here. Convert it to UTF-8 first:\n${full}`
    )
  }
  const changedOnDisk =
    expected !== undefined && (diskMtimeMs === null || Math.abs(diskMtimeMs - expected) > 1)
  if (changedOnDisk && !options.force) {
    throw new FileWriteError(`The file was changed or removed by another program:\n${full}`, true)
  }

  const data = encodeText(content, detectTextFormat(existing))
  const temp = join(dirname(target), `.${basename(target)}.${randomBytes(6).toString('hex')}.tmp`)
  try {
    await writeFile(temp, data, { flag: 'wx' })
    await rename(temp, target)
  } catch (err) {
    await rm(temp, { force: true }).catch(() => undefined)
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EACCES' || code === 'EPERM' || code === 'EBUSY') {
      throw new FileWriteError(
        `The file is read-only, locked by another program, or you do not have permission to change it:\n${full}`
      )
    }
    if (code === 'ENOSPC') throw new FileWriteError(`There is not enough disk space to save the file:\n${full}`)
    if (code === 'ENOENT') throw new FileWriteError(`The folder no longer exists:\n${dirname(full)}`)
    throw new FileWriteError(`Failed to save the file:\n${full}`)
  }

  const saved = await stat(target)
  return { path: full, mtimeMs: Number(saved.mtimeMs) }
}

/**
 * Watches the file's directory (more reliable on Windows than watching the file
 * directly because of atomic saves) and reports changes.
 */
export class FileWatcher {
  private watcher: FSWatcher | null = null
  private timer: NodeJS.Timeout | null = null
  private target = ''

  constructor(private readonly onChange: (filePath: string) => void, private readonly debounceMs = 150) {}

  watchFile(filePath: string): void {
    this.stop()
    this.target = resolve(filePath)
    const name = basename(this.target).toLowerCase()
    try {
      this.watcher = watch(dirname(this.target), { persistent: false }, (_event, changed) => {
        if (changed && String(changed).toLowerCase() !== name) return
        if (this.timer) clearTimeout(this.timer)
        this.timer = setTimeout(() => this.onChange(this.target), this.debounceMs)
      })
      this.watcher.on('error', () => this.stop())
    } catch {
      this.watcher = null
    }
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.watcher?.close()
    this.watcher = null
  }
}

/** Extracts the file path passed through argv (double-click in Explorer). */
export function filePathFromArgv(argv: string[], isPackaged: boolean): string | null {
  const args = argv.slice(isPackaged ? 1 : 2)
  for (const arg of args) {
    if (arg.startsWith('-')) continue
    if (isOpenablePath(arg)) return resolve(arg)
  }
  return null
}
