import { protocol, net } from 'electron'
import { pathToFileURL } from 'node:url'
import { realpathSync } from 'node:fs'
import { resolve, sep } from 'node:path'

/**
 * Protocolo próprio para imagens locais do documento. Necessário porque o
 * renderer roda em http:// no dev e em file:// no build — `mdasset://` funciona
 * nos dois casos e permite restringir o acesso às pastas dos arquivos abertos.
 */
export const MD_ASSET_SCHEME = 'mdasset'

const allowedRoots = new Set<string>()

function canonical(target: string): string {
  const full = resolve(target)
  try {
    // realpath resolve junções/symlinks: impede escapar da allowlist por link.
    return realpathSync.native(full).toLowerCase()
  } catch {
    return full.toLowerCase()
  }
}

export function allowAssetRoot(dir: string): void {
  allowedRoots.add(canonical(dir))
}

/** Remove pastas que não pertencem mais a nenhuma janela aberta. */
export function setAssetRoots(dirs: string[]): void {
  allowedRoots.clear()
  for (const dir of dirs) allowedRoots.add(canonical(dir))
}

function isAllowed(target: string): boolean {
  const lower = canonical(target)
  for (const root of allowedRoots) {
    if (lower === root || lower.startsWith(root.endsWith(sep) ? root : root + sep)) return true
  }
  return false
}

export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MD_ASSET_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
    }
  ])
}

export function handleAssetProtocol(): void {
  protocol.handle(MD_ASSET_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const filePath = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      if (!filePath || !isAllowed(filePath)) return new Response('Acesso negado', { status: 403 })
      return await net.fetch(pathToFileURL(filePath).toString())
    } catch {
      return new Response('Não encontrado', { status: 404 })
    }
  })
}
