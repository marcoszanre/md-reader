import type { Heading } from '../markdown/parser'

export class TocController {
  private observer: IntersectionObserver | null = null
  private links = new Map<string, HTMLAnchorElement>()

  constructor(
    private readonly container: HTMLElement,
    private readonly list: HTMLElement,
    private readonly onNavigate: (id: string) => void
  ) {}

  render(headings: Heading[]): void {
    this.list.textContent = ''
    this.links.clear()
    this.observer?.disconnect()

    if (headings.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'toc-empty'
      empty.textContent = 'No headings in this document.'
      this.list.appendChild(empty)
      return
    }

    const minLevel = Math.min(...headings.map((h) => h.level))
    for (const heading of headings) {
      const link = document.createElement('a')
      link.href = `#${heading.id}`
      link.textContent = heading.title
      link.title = heading.title
      link.className = `toc-item toc-level-${Math.min(heading.level - minLevel + 1, 4)}`
      link.addEventListener('click', (event) => {
        event.preventDefault()
        this.onNavigate(heading.id)
      })
      this.links.set(heading.id, link)
      this.list.appendChild(link)
    }
  }

  observe(content: HTMLElement, root: HTMLElement): void {
    this.observer?.disconnect()
    const targets = Array.from(content.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]'))
    if (targets.length === 0) return

    this.observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        const id = visible[0]?.target.id
        if (id) this.setActive(id)
      },
      { root, rootMargin: '0px 0px -70% 0px', threshold: 0 }
    )
    targets.forEach((target) => this.observer?.observe(target))
  }

  setActive(id: string): void {
    for (const [key, link] of this.links) {
      link.classList.toggle('active', key === id)
      if (key === id) link.scrollIntoView({ block: 'nearest' })
    }
  }

  setVisible(visible: boolean): void {
    this.container.hidden = !visible
    document.body.classList.toggle('toc-hidden', !visible)
  }
}
