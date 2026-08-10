import DOMPurify from 'dompurify'

/**
 * Todo HTML gerado a partir de um `.md` é tratado como não confiável.
 * `mdasset:` é liberado porque é o protocolo local de imagens do próprio app.
 */
const URI_REGEXP = /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|mdasset):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i

let hooked = false

function ensureHooks(): void {
  if (hooked) return
  hooked = true
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node instanceof HTMLAnchorElement) {
      node.setAttribute('rel', 'noopener noreferrer')
      node.removeAttribute('target')
    }
    // `input` só existe aqui por causa das task lists: apenas checkbox desabilitado.
    if (node instanceof HTMLInputElement) {
      if (node.getAttribute('type')?.toLowerCase() !== 'checkbox') {
        node.remove()
        return
      }
      node.setAttribute('disabled', '')
      node.removeAttribute('name')
      node.removeAttribute('value')
      node.removeAttribute('form')
    }
    // `//host/...` e `\\host\...` viram caminhos de rede em páginas file:,
    // o que dispararia autenticação SMB automática. Bloqueados sempre.
    for (const attr of ['src', 'href', 'xlink:href', 'action', 'data']) {
      const value = node instanceof Element ? node.getAttribute(attr) : null
      if (value && /^[\\/]{2}/.test(value.trim())) node.removeAttribute(attr)
    }
  })
}

const PURIFY_CONFIG = {
  ALLOWED_URI_REGEXP: URI_REGEXP,
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'button', 'link', 'meta', 'base'],
  FORBID_ATTR: ['srcset', 'ping', 'formaction'],
  ADD_ATTR: ['align', 'colspan', 'rowspan', 'start', 'type', 'checked', 'disabled']
}

export function sanitizeHtml(dirty: string): string {
  ensureHooks()
  return DOMPurify.sanitize(dirty, {
    ...PURIFY_CONFIG,
    USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true }
  })
}

/** SVG gerado pelo Mermaid também passa pelo sanitizador antes de ir ao DOM. */
export function sanitizeSvg(dirty: string): string {
  ensureHooks()
  return DOMPurify.sanitize(dirty, {
    ...PURIFY_CONFIG,
    USE_PROFILES: { svg: true, svgFilters: true, html: true }
  })
}
