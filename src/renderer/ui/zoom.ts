const MIN_ZOOM = 0.5
const MAX_ZOOM = 3
const STEP = 0.1

export class ZoomController {
  private zoom = 1

  constructor(private readonly onChange: (zoom: number) => void) {}

  set(value: number): void {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100))
    this.zoom = clamped
    document.documentElement.style.setProperty('--zoom', String(clamped))
    this.onChange(clamped)
  }

  get current(): number {
    return this.zoom
  }

  in(): void {
    this.set(this.zoom + STEP)
  }

  out(): void {
    this.set(this.zoom - STEP)
  }

  reset(): void {
    this.set(1)
  }
}
