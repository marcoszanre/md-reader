import { describe, it, expect } from 'vitest'
import { resolveLocalPath, toAssetUrl, isRemoteUrl, isAbsoluteLocalPath, resolveAssetUrl } from '../src/renderer/markdown/paths'

describe('paths', () => {
  it('resolves a simple relative path', () => {
    expect(resolveLocalPath('C:/docs', 'img/photo.png')).toBe('C:/docs/img/photo.png')
  })

  it('resolves paths with ./ and ../', () => {
    expect(resolveLocalPath('C:/docs/sub', '../img/photo.png')).toBe('C:/docs/img/photo.png')
    expect(resolveLocalPath('C:/docs', './photo.png')).toBe('C:/docs/photo.png')
  })

  it('does not move above the root', () => {
    expect(resolveLocalPath('C:/docs', '../../../../photo.png')).toBe('C:/photo.png')
  })

  it('keeps absolute paths', () => {
    expect(resolveLocalPath('C:/docs', 'D:/other/photo.png')).toBe('D:/other/photo.png')
    expect(isAbsoluteLocalPath('D:\\other\\photo.png')).toBe(true)
  })

  it('ignores query strings and anchors', () => {
    expect(resolveLocalPath('C:/docs', 'photo.png?v=2#top')).toBe('C:/docs/photo.png')
  })

  it('decodes Windows separators', () => {
    expect(resolveLocalPath('C:\\docs', 'img\\photo.png')).toBe('C:/docs/img/photo.png')
  })

  it('detects remote URLs', () => {
    expect(isRemoteUrl('https://example.com/a.png')).toBe(true)
    expect(isRemoteUrl('data:image/png;base64,AAA')).toBe(true)
    expect(isRemoteUrl('./local.png')).toBe(false)
  })

  it('generates escaped mdasset URLs', () => {
    expect(toAssetUrl('C:/docs/image with space.png')).toBe('mdasset://local/C%3A/docs/image%20with%20space.png')
  })

  it('resolveAssetUrl preserves remote URLs and converts local paths', () => {
    expect(resolveAssetUrl('C:/docs', 'https://x/y.png')).toBe('https://x/y.png')
    expect(resolveAssetUrl('C:/docs', 'a.png')).toBe('mdasset://local/C%3A/docs/a.png')
  })
})
