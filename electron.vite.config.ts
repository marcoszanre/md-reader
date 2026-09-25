import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'

const PROD_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' mdasset: data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' mdasset: data:",
  "media-src 'self' mdasset: data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "object-src 'none'"
].join('; ')

const DEV_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' mdasset: data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' mdasset: data: ws://localhost:* http://localhost:*",
  "media-src 'self' mdasset: data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "object-src 'none'"
].join('; ')

/** Injects the CSP into index.html: strict for builds, with HMR allowed in dev. */
function cspPlugin(): Plugin {
  let isDev = false
  return {
    name: 'mdreader-csp',
    configResolved(config) {
      isDev = config.command === 'serve'
    },
    transformIndexHtml(html) {
      return html.replace('%CSP%', isDev ? DEV_CSP : PROD_CSP)
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [cspPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    }
  }
})
