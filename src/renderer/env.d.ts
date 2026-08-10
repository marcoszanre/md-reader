/// <reference types="vite/client" />

import type { MdReaderAPI } from '../shared/api'

declare global {
  interface Window {
    mdreader: MdReaderAPI
  }
}

export {}
