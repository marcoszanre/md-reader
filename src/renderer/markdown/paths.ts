const WINDOWS_ABSOLUTE = /^[a-zA-Z]:[\\/]/
const UNC = /^\\\\/

export function isRemoteUrl(url: string): boolean {
  return /^(https?:|data:|blob:|mailto:|mdasset:)/i.test(url)
}

export function isAbsoluteLocalPath(p: string): boolean {
  return WINDOWS_ABSOLUTE.test(p) || UNC.test(p) || p.startsWith('/')
}

function normalizeSegments(parts: string[]): string[] {
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length > 0) out.pop()
      continue
    }
    out.push(part)
  }
  return out
}

/** Resolves a document-relative path without depending on the `path` module. */
export function resolveLocalPath(docDir: string, target: string): string {
  const clean = decodeURI(target.replace(/^file:\/\/\//i, '')).split('#')[0]!.split('?')[0]!
  if (isAbsoluteLocalPath(clean)) return clean.replace(/\\/g, '/')
  const base = docDir.replace(/\\/g, '/').replace(/\/+$/, '')
  const merged = `${base}/${clean.replace(/\\/g, '/')}`
  const [root, ...rest] = merged.split('/')
  return [root, ...normalizeSegments(rest)].join('/')
}

/** Converts an absolute local path into the URL served by the `mdasset` protocol. */
export function toAssetUrl(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, '/').replace(/^\/+/, '')
  const encoded = normalized.split('/').map(encodeURIComponent).join('/')
  return `mdasset://local/${encoded}`
}

/** Markdown image path to a renderer-usable URL. */
export function resolveAssetUrl(docDir: string, src: string): string {
  if (isRemoteUrl(src)) return src
  return toAssetUrl(resolveLocalPath(docDir, src))
}
