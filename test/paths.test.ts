import { describe, it, expect } from 'vitest'
import { resolveLocalPath, toAssetUrl, isRemoteUrl, isAbsoluteLocalPath, resolveAssetUrl } from '../src/renderer/markdown/paths'

describe('paths', () => {
  it('resolve caminho relativo simples', () => {
    expect(resolveLocalPath('C:/docs', 'img/foto.png')).toBe('C:/docs/img/foto.png')
  })

  it('resolve caminho com ./ e ../', () => {
    expect(resolveLocalPath('C:/docs/sub', '../img/foto.png')).toBe('C:/docs/img/foto.png')
    expect(resolveLocalPath('C:/docs', './foto.png')).toBe('C:/docs/foto.png')
  })

  it('não sobe acima da raiz', () => {
    expect(resolveLocalPath('C:/docs', '../../../../foto.png')).toBe('C:/foto.png')
  })

  it('mantém caminho absoluto', () => {
    expect(resolveLocalPath('C:/docs', 'D:/outro/foto.png')).toBe('D:/outro/foto.png')
    expect(isAbsoluteLocalPath('D:\\outro\\foto.png')).toBe(true)
  })

  it('ignora query string e âncora', () => {
    expect(resolveLocalPath('C:/docs', 'foto.png?v=2#topo')).toBe('C:/docs/foto.png')
  })

  it('decodifica separadores do Windows', () => {
    expect(resolveLocalPath('C:\\docs', 'img\\foto.png')).toBe('C:/docs/img/foto.png')
  })

  it('detecta URLs remotas', () => {
    expect(isRemoteUrl('https://exemplo.com/a.png')).toBe(true)
    expect(isRemoteUrl('data:image/png;base64,AAA')).toBe(true)
    expect(isRemoteUrl('./local.png')).toBe(false)
  })

  it('gera URL mdasset com escape', () => {
    expect(toAssetUrl('C:/docs/imagem com espaço.png')).toBe('mdasset://local/C%3A/docs/imagem%20com%20espa%C3%A7o.png')
  })

  it('resolveAssetUrl preserva remoto e converte local', () => {
    expect(resolveAssetUrl('C:/docs', 'https://x/y.png')).toBe('https://x/y.png')
    expect(resolveAssetUrl('C:/docs', 'a.png')).toBe('mdasset://local/C%3A/docs/a.png')
  })
})
