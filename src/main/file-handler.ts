import { watch, type FSWatcher } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, resolve, extname } from 'node:path'
import { MARKDOWN_EXTENSIONS, LARGE_FILE_WARNING_BYTES } from '../shared/types'

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
  return MARKDOWN_EXTENSIONS.includes(extname(filePath).replace('.', '').toLowerCase())
}

/** Lê um `.md` do disco, traduzindo erros do SO em mensagens em português. */
export async function readMarkdownFile(filePath: string): Promise<{ path: string; content: string }> {
  const full = resolve(filePath)
  let info
  try {
    info = await stat(full)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') throw new FileReadError(`Arquivo não encontrado:\n${full}`)
    if (code === 'EACCES' || code === 'EPERM') throw new FileReadError(`Sem permissão para ler o arquivo:\n${full}`)
    throw new FileReadError(`Não foi possível acessar o arquivo:\n${full}`)
  }

  if (!info.isFile()) throw new FileReadError(`O caminho não é um arquivo:\n${full}`)
  if (info.size > LARGE_FILE_WARNING_BYTES) {
    const mb = (info.size / (1024 * 1024)).toFixed(1)
    throw new FileReadError(
      `Arquivo muito grande (${mb} MB). O limite para abrir com segurança é de 20 MB:\n${full}`
    )
  }

  try {
    const buffer = await readFile(full)
    return { path: full, content: decode(buffer) }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EACCES' || code === 'EPERM') throw new FileReadError(`Sem permissão para ler o arquivo:\n${full}`)
    throw new FileReadError(`Falha ao ler o arquivo (encoding inválido ou disco indisponível):\n${full}`)
  }
}

/**
 * Observa o diretório do arquivo (mais confiável no Windows que observar o
 * arquivo direto, por causa de saves atômicos) e avisa em alterações.
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

/** Extrai o caminho do `.md` passado por argv (duplo clique no Explorer). */
export function filePathFromArgv(argv: string[], isPackaged: boolean): string | null {
  const args = argv.slice(isPackaged ? 1 : 2)
  for (const arg of args) {
    if (arg.startsWith('-')) continue
    if (isMarkdownPath(arg)) return resolve(arg)
  }
  return null
}
