import { protocol, net } from 'electron'
import { pathToFileURL } from 'node:url'
import { realpathSync } from 'node:fs'
import { resolve, sep } from 'node:path'

/**
 * Custom protocol for local document images. Required because the renderer runs
 * on http:// in dev and file:// in builds; `mdasset://` works in both cases and
 * lets the app restrict access to folders for open files.
 */
export const MD_ASSET_SCHEME = 'mdasset'

const allowedRoots = new Set<string>()

function canonical(target: string): string {
  const full = resolve(target)
  try {
    // realpath resolves junctions/symlinks, preventing allowlist escapes through links.
    return realpathSync.native(full).toLowerCase()
  } catch {
    return full.toLowerCase()
  }
}

export function allowAssetRoot(dir: string): void {
  allowedRoots.add(canonical(dir))
}

/** Removes folders that no longer belong to any open window. */
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
      if (!filePath || !isAllowed(filePath)) return new Response('Access denied', { status: 403 })
      return await net.fetch(pathToFileURL(filePath).toString())
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}
