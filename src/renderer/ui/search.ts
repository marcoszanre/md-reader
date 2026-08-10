interface HighlightRegistryLike {
  set(name: string, highlight: unknown): void
  delete(name: string): void
}

interface HighlightConstructor {
  new (...ranges: Range[]): unknown
}

// A CSS Custom Highlight API evita mexer no DOM do documento durante a busca.
const highlightApi = (() => {
  const ctor = (globalThis as { Highlight?: HighlightConstructor }).Highlight
  const registry = (CSS as unknown as { highlights?: HighlightRegistryLike }).highlights
  return ctor && registry ? { ctor, registry } : null
})()

export class SearchController {
  private matches: Range[] = []
  private index = -1
  private query = ''

  constructor(
    private readonly content: HTMLElement,
    private readonly scroller: HTMLElement,
    private readonly bar: HTMLElement,
    private readonly input: HTMLInputElement,
    private readonly counter: HTMLElement
  ) {}

  open(): void {
    this.bar.hidden = false
    this.input.focus()
    this.input.select()
    if (this.input.value) this.search(this.input.value)
  }

  close(): void {
    this.bar.hidden = true
    this.clearHighlights()
    this.matches = []
    this.index = -1
    this.counter.textContent = '0 de 0'
  }

  get isOpen(): boolean {
    return !this.bar.hidden
  }

  /** Reexecuta a busca atual — usado após o live reload. */
  refresh(): void {
    if (this.isOpen && this.query) this.search(this.query, false)
  }

  search(query: string, scroll = true): void {
    this.query = query
    this.clearHighlights()
    this.matches = query.trim().length > 0 ? this.collect(query) : []
    this.index = this.matches.length > 0 ? 0 : -1
    this.paint()
    this.updateCounter()
    if (scroll) this.scrollToActive()
  }

  next(): void {
    if (this.matches.length === 0) return
    this.index = (this.index + 1) % this.matches.length
    this.paint()
    this.updateCounter()
    this.scrollToActive()
  }

  previous(): void {
    if (this.matches.length === 0) return
    this.index = (this.index - 1 + this.matches.length) % this.matches.length
    this.paint()
    this.updateCounter()
    this.scrollToActive()
  }

  private collect(query: string): Range[] {
    const needle = query.toLowerCase()
    const walker = document.createTreeWalker(this.content, NodeFilter.SHOW_TEXT)
    const found: Range[] = []
    let node = walker.nextNode() as Text | null
    while (node) {
      const haystack = node.data.toLowerCase()
      let from = haystack.indexOf(needle)
      while (from !== -1) {
        const range = document.createRange()
        range.setStart(node, from)
        range.setEnd(node, from + needle.length)
        found.push(range)
        from = haystack.indexOf(needle, from + needle.length)
        if (found.length > 5000) return found
      }
      node = walker.nextNode() as Text | null
    }
    return found
  }

  private paint(): void {
    if (!highlightApi) return
    const active = this.index >= 0 ? this.matches[this.index] : undefined
    const others = this.matches.filter((_, i) => i !== this.index)
    highlightApi.registry.set('mdsearch', new highlightApi.ctor(...others))
    highlightApi.registry.set('mdsearch-active', new highlightApi.ctor(...(active ? [active] : [])))
  }

  private clearHighlights(): void {
    if (!highlightApi) return
    highlightApi.registry.delete('mdsearch')
    highlightApi.registry.delete('mdsearch-active')
  }

  private updateCounter(): void {
    const total = this.matches.length
    this.counter.textContent = total === 0 ? '0 de 0' : `${this.index + 1} de ${total}`
    this.counter.classList.toggle('no-results', total === 0 && this.query.trim().length > 0)
  }

  private scrollToActive(): void {
    const range = this.index >= 0 ? this.matches[this.index] : undefined
    if (!range) return
    const rect = range.getBoundingClientRect()
    const view = this.scroller.getBoundingClientRect()
    if (rect.top < view.top + 60 || rect.bottom > view.bottom - 40) {
      this.scroller.scrollBy({ top: rect.top - view.top - view.height / 3 })
    }
  }
}
