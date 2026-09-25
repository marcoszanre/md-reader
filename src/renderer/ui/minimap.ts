/**
 * VS Code–style minimap for the reading pane.
 *
 * The document is summarized once per layout into a list of shapes (text line
 * fragments, headings, code/table/image areas) and painted onto an offscreen
 * canvas. Scrolling only blits the visible slice and draws the viewport slider,
 * so it stays cheap even for long documents.
 */

interface Shape {
  x: number
  y: number
  w: number
  h: number
  kind: 'text' | 'heading' | 'code' | 'link' | 'area' | 'rule' | 'quote'
}

interface Label {
  y: number
  text: string
  level: number
}

const WIDTH = 104
/** Chromium caps canvas dimensions; stay well below the limit. */
const MAX_CANVAS_PX = 30000
/** Beyond this, line-level detail is replaced by block outlines to keep layout work bounded. */
const MAX_DETAILED_BLOCKS = 1500
const MAX_DETAILED_CHARS = 400_000

export class MinimapController {
  private readonly canvas = document.createElement('canvas')
  private readonly ctx = this.canvas.getContext('2d')!
  private offscreen: HTMLCanvasElement | null = null

  private shapes: Shape[] = []
  private labels: Label[] = []
  private marks: { y: number; active: boolean }[] = []
  private scale = 0.1
  private enabled = true
  private hasDocument = false
  private hover = false
  private dragOffset: number | null = null
  private collectTimer: number | undefined
  private frame = 0

  constructor(
    private readonly root: HTMLElement,
    private readonly scroller: HTMLElement,
    private readonly content: HTMLElement
  ) {
    this.canvas.className = 'minimap-canvas'
    this.canvas.setAttribute('aria-hidden', 'true')
    root.appendChild(this.canvas)

    scroller.addEventListener('scroll', () => this.requestDraw(), { passive: true })
    new ResizeObserver(() => this.refresh()).observe(content)
    new ResizeObserver(() => this.refresh()).observe(root)

    root.addEventListener('pointerdown', (event) => this.onPointerDown(event))
    root.addEventListener('pointermove', (event) => this.onPointerMove(event))
    root.addEventListener('pointerup', (event) => this.onPointerUp(event))
    root.addEventListener('pointercancel', (event) => this.onPointerUp(event))
    root.addEventListener('pointerenter', () => {
      this.hover = true
      this.requestDraw()
    })
    root.addEventListener('pointerleave', () => {
      this.hover = false
      this.requestDraw()
    })
    // The minimap sits beside the scroller, so wheel events are forwarded to it.
    root.addEventListener(
      'wheel',
      (event) => {
        if (event.ctrlKey) return
        event.preventDefault()
        this.scroller.scrollBy({ top: event.deltaY, behavior: 'auto' })
      },
      { passive: false }
    )
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.updateVisibility()
    this.refresh()
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  /** Whether the current view has something worth mapping (Markdown or text, not images or errors). */
  setDocument(hasDocument: boolean): void {
    this.hasDocument = hasDocument
    this.updateVisibility()
    this.refresh()
  }

  /** Search results to mark along the minimap. */
  setMarks(ranges: Range[], activeIndex: number): void {
    const origin = this.origin()
    this.marks = ranges.slice(0, 2000).map((range, i) => ({
      y: range.getBoundingClientRect().top - origin.top,
      active: i === activeIndex
    }))
    this.requestDraw()
  }

  /** Re-reads the layout (after rendering, resizing, zooming or a theme change). */
  refresh(): void {
    window.clearTimeout(this.collectTimer)
    this.collectTimer = window.setTimeout(() => {
      if (!this.visible) return
      this.collect()
      this.paintOffscreen()
      this.requestDraw()
    }, 120)
  }

  private get visible(): boolean {
    return !this.root.hidden && this.root.offsetParent !== null
  }

  private updateVisibility(): void {
    const show = this.enabled && this.hasDocument
    this.root.hidden = !show
    document.body.classList.toggle('minimap-on', show)
  }

  /** Document coordinates are relative to the top of the scrollable area. */
  private origin(): { top: number; left: number } {
    const view = this.scroller.getBoundingClientRect()
    const style = getComputedStyle(this.content)
    const box = this.content.getBoundingClientRect()
    return {
      top: view.top - this.scroller.scrollTop,
      left: box.left + parseFloat(style.paddingLeft)
    }
  }

  private collect(): void {
    const origin = this.origin()
    const style = getComputedStyle(this.content)
    const innerWidth = Math.max(
      1,
      this.content.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    )
    const docHeight = Math.max(1, this.scroller.scrollHeight)
    const dpr = window.devicePixelRatio || 1
    this.scale = Math.min((WIDTH - 12) / innerWidth, MAX_CANVAS_PX / (docHeight * dpr))

    const detailed =
      !this.content.classList.contains('virtualized') &&
      this.content.childElementCount <= MAX_DETAILED_BLOCKS &&
      (this.content.textContent?.length ?? 0) <= MAX_DETAILED_CHARS

    const shapes: Shape[] = []
    const labels: Label[] = []
    const toShape = (rect: DOMRect, kind: Shape['kind']): Shape => ({
      x: rect.left - origin.left,
      y: rect.top - origin.top,
      w: rect.width,
      h: rect.height,
      kind
    })

    for (const child of Array.from(this.content.children) as HTMLElement[]) {
      const rect = child.getBoundingClientRect()
      if (rect.height === 0 || child.classList.contains('block-add')) continue

      const heading = /^H([1-6])$/.exec(child.tagName)
      if (heading) {
        const level = Number(heading[1])
        const title = (child.textContent ?? '').replace(/\s*#\s*$/, '').trim()
        if (level <= 3 && title) labels.push({ y: rect.top - origin.top, text: title, level })
      }

      const isArea = child.matches('pre, .code-block, .mermaid-block, table, details, figure, .text-view')
      if (isArea) {
        shapes.push(toShape(rect, 'area'))
      } else if (child.tagName === 'HR') {
        shapes.push(toShape(rect, 'rule'))
      } else if (child.tagName === 'BLOCKQUOTE') {
        shapes.push({ ...toShape(rect, 'quote'), w: 3 })
      }
      // Images inside regular blocks (areas such as diagrams are already covered).
      if (!isArea) {
        for (const media of Array.from(child.querySelectorAll('img, svg'))) {
          const box = media.getBoundingClientRect()
          if (box.width > 16 && box.height > 16) shapes.push(toShape(box, 'area'))
        }
      }

      if (heading && !detailed) {
        shapes.push(toShape(rect, 'heading'))
      } else if (detailed) {
        this.collectLines(child, heading ? 'heading' : null, toShape, shapes)
      } else {
        shapes.push(toShape(rect, 'text'))
      }
    }

    this.shapes = shapes
    this.labels = labels
  }

  /** One shape per rendered line fragment of every text node. */
  private collectLines(
    block: HTMLElement,
    forced: Shape['kind'] | null,
    toShape: (rect: DOMRect, kind: Shape['kind']) => Shape,
    out: Shape[]
  ): void {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
    const range = document.createRange()
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue?.trim()) continue
      const parent = node.parentElement
      if (!parent || parent.closest('.heading-anchor, .copy-btn, .code-lang, [hidden]')) continue
      const kind: Shape['kind'] =
        forced ?? (parent.closest('pre, code') ? 'code' : parent.closest('a') ? 'link' : 'text')
      range.selectNodeContents(node)
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width > 0.5) out.push(toShape(rect, kind))
      }
    }
  }

  private colors(): Record<string, string> {
    const style = getComputedStyle(document.body)
    const v = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback
    return {
      text: v('--fg-muted', '#8b949e'),
      heading: v('--accent', '#8b7cf6'),
      link: v('--accent', '#8b7cf6'),
      code: v('--fg-muted', '#8b949e'),
      area: v('--bg-hover', '#21262d'),
      rule: v('--border-strong', '#484f58'),
      quote: v('--accent', '#8b7cf6'),
      fg: v('--fg', '#e6edf3'),
      bg: v('--bg', '#0d1117'),
      mark: v('--search-active-bg', '#8b7cf6')
    }
  }

  private paintOffscreen(): void {
    const dpr = window.devicePixelRatio || 1
    const s = this.scale
    const height = Math.max(1, Math.ceil(this.scroller.scrollHeight * s))
    const canvas = (this.offscreen ??= document.createElement('canvas'))
    canvas.width = Math.round(WIDTH * dpr)
    canvas.height = Math.min(MAX_CANVAS_PX, Math.round(height * dpr))
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, WIDTH, height)

    const colors = this.colors()
    const left = 6
    const order: Shape['kind'][] = ['area', 'rule', 'quote', 'code', 'text', 'link', 'heading']
    for (const kind of order) {
      ctx.fillStyle = colors[kind]!
      ctx.globalAlpha = kind === 'area' ? 0.9 : kind === 'heading' ? 0.95 : kind === 'text' ? 0.55 : 0.7
      for (const shape of this.shapes) {
        if (shape.kind !== kind) continue
        const x = left + shape.x * s
        const w = Math.max(1, Math.min(WIDTH - left - 2, shape.w * s))
        const y = shape.y * s
        if (kind === 'area' || kind === 'quote') {
          ctx.fillRect(x, y, w, Math.max(1, shape.h * s))
        } else if (kind === 'rule') {
          ctx.fillRect(x, y + (shape.h * s) / 2, w, 1)
        } else {
          // Lines are drawn as thin bars roughly the height of lowercase letters.
          const barHeight = Math.max(1, Math.min(shape.h * s * 0.55, kind === 'heading' ? 4 : 2.2))
          ctx.fillRect(x, y + (shape.h * s - barHeight) / 2, w, barHeight)
        }
      }
    }

    // Section titles make the minimap a real outline for Markdown documents.
    ctx.globalAlpha = 1
    ctx.textBaseline = 'top'
    let lastBottom = -Infinity
    for (const label of this.labels) {
      const y = label.y * s
      const size = label.level === 1 ? 10 : label.level === 2 ? 9 : 8
      if (y < lastBottom + 2) continue
      ctx.font = `${label.level <= 2 ? 700 : 600} ${size}px "Segoe UI", system-ui, sans-serif`
      const text = this.fit(ctx, label.text, WIDTH - left - 6)
      const width = ctx.measureText(text).width
      ctx.fillStyle = colors.bg!
      ctx.globalAlpha = 0.85
      ctx.fillRect(left - 2, y - 1, width + 6, size + 3)
      ctx.globalAlpha = 1
      ctx.fillStyle = label.level === 1 ? colors.fg! : colors.heading!
      ctx.fillText(text, left + 1, y)
      lastBottom = y + size + 2
    }
  }

  private fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
    if (ctx.measureText(text).width <= max) return text
    let lo = 0
    let hi = text.length
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      if (ctx.measureText(`${text.slice(0, mid)}…`).width <= max) lo = mid
      else hi = mid - 1
    }
    return `${text.slice(0, lo).trimEnd()}…`
  }

  private requestDraw(): void {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.draw()
    })
  }

  /** Geometry of the current frame, in canvas CSS pixels. */
  private geometry(): { offset: number; sliderTop: number; sliderHeight: number; canvasHeight: number; k: number } {
    const canvasHeight = this.root.clientHeight
    const viewHeight = this.scroller.clientHeight
    const maxScroll = Math.max(0, this.scroller.scrollHeight - viewHeight)
    const miniHeight = this.scroller.scrollHeight * this.scale
    const overflow = Math.max(0, miniHeight - canvasHeight)
    const offset = maxScroll > 0 ? (this.scroller.scrollTop / maxScroll) * overflow : 0
    const sliderHeight = Math.max(12, viewHeight * this.scale)
    const sliderTop = this.scroller.scrollTop * this.scale - offset
    // Slider pixels per scrolled document pixel.
    const k = maxScroll > 0 ? (overflow > 0 ? (canvasHeight - viewHeight * this.scale) / maxScroll : this.scale) : 0
    return { offset, sliderTop, sliderHeight, canvasHeight, k }
  }

  private draw(): void {
    if (!this.visible) return
    const dpr = window.devicePixelRatio || 1
    const { offset, sliderTop, sliderHeight, canvasHeight } = this.geometry()
    const width = Math.round(WIDTH * dpr)
    const height = Math.round(canvasHeight * dpr)
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }
    const ctx = this.ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, width, height)
    if (this.offscreen && this.offscreen.height > 0) {
      const sy = Math.round(offset * dpr)
      const sh = Math.min(height, this.offscreen.height - sy)
      if (sh > 0) ctx.drawImage(this.offscreen, 0, sy, width, sh, 0, 0, width, sh)
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const colors = this.colors()
    ctx.fillStyle = colors.fg!
    ctx.globalAlpha = this.dragOffset !== null ? 0.2 : this.hover ? 0.14 : 0.07
    ctx.fillRect(0, sliderTop, WIDTH, sliderHeight)
    ctx.globalAlpha = 1

    // Search matches, VS Code style: small marks on the right edge.
    if (this.marks.length) {
      ctx.fillStyle = colors.mark!
      for (const mark of this.marks) {
        const y = mark.y * this.scale - offset
        if (y < -2 || y > canvasHeight + 2) continue
        ctx.globalAlpha = mark.active ? 1 : 0.7
        ctx.fillRect(WIDTH - (mark.active ? 8 : 6), y - 1, mark.active ? 8 : 6, mark.active ? 3 : 2)
      }
      ctx.globalAlpha = 1
    }
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return
    event.preventDefault()
    const y = event.offsetY
    const { offset, sliderTop, sliderHeight } = this.geometry()
    if (y < sliderTop || y > sliderTop + sliderHeight) {
      // Click outside the slider: center the viewport on that part of the document.
      const docY = (y + offset) / this.scale
      this.scroller.scrollTop = docY - this.scroller.clientHeight / 2
    }
    this.dragOffset = y - this.geometry().sliderTop
    this.root.setPointerCapture(event.pointerId)
    this.root.classList.add('dragging')
    this.requestDraw()
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.dragOffset === null) return
    const { k } = this.geometry()
    if (k > 0) this.scroller.scrollTop = (event.offsetY - this.dragOffset) / k
  }

  private onPointerUp(event: PointerEvent): void {
    if (this.dragOffset === null) return
    this.dragOffset = null
    this.root.classList.remove('dragging')
    if (this.root.hasPointerCapture(event.pointerId)) this.root.releasePointerCapture(event.pointerId)
    this.requestDraw()
  }
}
