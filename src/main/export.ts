import { dialog, type BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { basename, join, dirname } from 'node:path'
import { currentPathOf } from './window'

export async function exportPdf(win: BrowserWindow): Promise<string | null> {
  const source = currentPathOf(win)
  const suggested = source ? basename(source).replace(/\.[^.]+$/, '') + '.pdf' : 'documento.pdf'

  const result = await dialog.showSaveDialog(win, {
    title: 'Exportar para PDF',
    defaultPath: source ? join(dirname(source), suggested) : suggested,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })
  if (result.canceled || !result.filePath) return null

  try {
    const data = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'default' }
    })
    await writeFile(result.filePath, data)
    return result.filePath
  } catch {
    await dialog.showMessageBox(win, {
      type: 'error',
      title: 'Falha ao exportar',
      message: 'Não foi possível gerar o PDF.',
      detail: 'Verifique se você tem permissão de escrita na pasta escolhida e tente novamente.'
    })
    return null
  }
}
