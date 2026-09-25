import { describe, it, expect } from 'vitest'
import {
  normalizeDir,
  isWithin,
  isNetworkPath,
  canBrowse,
  nextBrowseRoot,
  assetRoot
} from '../src/main/browse-scope'

const docDir = normalizeDir('C:/docs/deck/01-observability')
const deck = normalizeDir('C:/docs/deck')
const sibling = normalizeDir('C:/docs/deck/02-governance')

describe('browse-scope', () => {
  it('normalizes for case-insensitive comparison', () => {
    expect(normalizeDir('C:\\Docs\\Deck')).toBe(normalizeDir('c:/docs/deck'))
  })

  it('isWithin respects folder boundaries', () => {
    expect(isWithin(docDir, deck)).toBe(true)
    expect(isWithin(deck, deck)).toBe(true)
    expect(isWithin(normalizeDir('C:/docs/deck-other'), deck)).toBe(false)
  })

  it('blocks network paths', () => {
    expect(isNetworkPath('\\\\server\\share')).toBe(true)
    expect(canBrowse('\\\\server\\share', docDir, deck)).toBe(false)
  })

  it('allows the document folder and its descendants', () => {
    expect(canBrowse(docDir, docDir, docDir)).toBe(true)
    expect(canBrowse(normalizeDir('C:/docs/deck/01-observability/img'), docDir, docDir)).toBe(true)
  })

  it('allows moving one level up from the document folder', () => {
    expect(canBrowse(deck, docDir, docDir)).toBe(true)
  })

  it('denies a sibling folder before moving up and allows it afterward', () => {
    expect(canBrowse(sibling, docDir, docDir)).toBe(false)
    const root = nextBrowseRoot(deck, docDir)
    expect(root).toBe(deck)
    expect(canBrowse(sibling, docDir, root)).toBe(true)
  })

  it('does not move the root down when the user enters a subfolder', () => {
    expect(nextBrowseRoot(sibling, deck)).toBe(deck)
  })

  it('denies folders outside the reached root', () => {
    expect(canBrowse(normalizeDir('C:/other/place'), docDir, deck)).toBe(false)
  })

  it('image root covers the sibling folder referenced by ../', () => {
    // `docs/EVIDENCE.md` referencing `../evidence/photo.png`.
    const docs = normalizeDir('C:/lab/docs')
    const root = assetRoot(docs, normalizeDir('C:/lab'), null)
    expect(root).toBe(normalizeDir('C:/lab'))
    expect(isWithin(normalizeDir('C:/lab/evidence/photo.png'), root)).toBe(true)
    expect(isWithin(normalizeDir('C:/other/photo.png'), root)).toBe(false)
  })

  it('image root follows browsing when it is broader', () => {
    const docs = normalizeDir('C:/lab/docs')
    expect(assetRoot(docs, normalizeDir('C:/lab'), normalizeDir('C:/'))).toBe(normalizeDir('C:/'))
    // A narrower browse root does not reduce the default scope.
    expect(assetRoot(docs, normalizeDir('C:/lab'), docs)).toBe(normalizeDir('C:/lab'))
  })
})
