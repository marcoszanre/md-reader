import type { Settings } from '../../shared/types'

export type Theme = Settings['theme']

export class ThemeController {
  private theme: Theme = 'system'
  private readonly media = window.matchMedia('(prefers-color-scheme: dark)')

  constructor(private readonly onChange: (theme: Theme, effectiveDark: boolean) => void) {
    this.media.addEventListener('change', () => {
      if (this.theme === 'system') this.apply()
    })
  }

  set(theme: Theme): void {
    this.theme = theme
    this.apply()
  }

  get current(): Theme {
    return this.theme
  }

  get isDark(): boolean {
    return this.theme === 'dark' || (this.theme === 'system' && this.media.matches)
  }

  /** Ciclo claro → escuro → sistema. */
  toggle(): Theme {
    this.set(this.theme === 'light' ? 'dark' : this.theme === 'dark' ? 'system' : 'light')
    return this.theme
  }

  private apply(): void {
    const dark = this.isDark
    document.body.dataset.theme = dark ? 'dark' : 'light'
    document.body.dataset.themeMode = this.theme
    this.onChange(this.theme, dark)
  }
}
