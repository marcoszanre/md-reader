import { resolve, sep } from 'node:path'

/** Normalizes for comparison: Windows paths are case-insensitive. */
export function normalizeDir(dir: string): string {
  return resolve(dir).toLowerCase()
}

/** `true` when `target` is `parent` itself or a folder inside it. */
export function isWithin(target: string, parent: string): boolean {
  if (target === parent) return true
  const prefix = parent.endsWith(sep) ? parent : parent + sep
  return target.startsWith(prefix)
}

/** Network paths (UNC) stay out of the explorer to avoid silent SMB/NTLM authentication. */
export function isNetworkPath(dir: string): boolean {
  return dir.startsWith('\\\\') || dir.startsWith('//')
}

/**
 * Determines whether the explorer can list `target`. Allowed locations are the
 * browse root reached by the user and everything below it, folders above it
 * (moving up one level), and the open document tree.
 */
export function canBrowse(target: string, docDir: string, root: string): boolean {
  if (isNetworkPath(target)) return false
  return isWithin(target, root) || isWithin(root, target) || isWithin(target, docDir)
}

/** The root moves up when the user opens a folder above it; otherwise it stays put. */
export function nextBrowseRoot(target: string, root: string): string {
  return isWithin(root, target) ? target : root
}

/**
 * Folder that can serve a document's images. It is the parent of the document
 * folder (references such as `../evidence/photo.png` are common in
 * documentation repositories) or the browse root when it is broader.
 */
export function assetRoot(docDir: string, parentDir: string, browseRoot: string | null): string {
  const base = normalizeDir(parentDir === docDir ? docDir : parentDir)
  if (!browseRoot) return base
  return isWithin(base, browseRoot) ? browseRoot : base
}
