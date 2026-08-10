import { describe, it, expect } from 'vitest'
import { isMarkdownPath, filePathFromArgv, readMarkdownFile, FileReadError } from '../src/main/file-handler'
import { resolve } from 'node:path'

const fixture = resolve(__dirname, 'fixtures/basico.md')

describe('file-handler', () => {
  it('reconhece extensões de markdown', () => {
    expect(isMarkdownPath('a.md')).toBe(true)
    expect(isMarkdownPath('a.MARKDOWN')).toBe(true)
    expect(isMarkdownPath('a.mkd')).toBe(true)
    expect(isMarkdownPath('a.docx')).toBe(false)
  })

  it('extrai o arquivo do argv empacotado', () => {
    expect(filePathFromArgv(['mdreader.exe', 'C:\\docs\\a.md'], true)).toBe(resolve('C:/docs/a.md'))
  })

  it('extrai o arquivo do argv em dev', () => {
    expect(filePathFromArgv(['electron', '.', 'C:\\docs\\a.md'], false)).toBe(resolve('C:/docs/a.md'))
  })

  it('ignora flags e arquivos não markdown', () => {
    expect(filePathFromArgv(['mdreader.exe', '--flag', 'foto.png'], true)).toBeNull()
  })

  it('lê um arquivo existente', async () => {
    const result = await readMarkdownFile(fixture)
    expect(result.content).toContain('# Documento básico')
    expect(result.path).toBe(fixture)
  })

  it('erro em português quando o arquivo não existe', async () => {
    await expect(readMarkdownFile(resolve(__dirname, 'fixtures/nao-existe.md'))).rejects.toBeInstanceOf(FileReadError)
    await expect(readMarkdownFile(resolve(__dirname, 'fixtures/nao-existe.md'))).rejects.toThrow(
      /Arquivo não encontrado/
    )
  })

  it('erro ao apontar para um diretório', async () => {
    await expect(readMarkdownFile(resolve(__dirname, 'fixtures'))).rejects.toThrow(/não é um arquivo/)
  })
})
