/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />


interface ImportMetaEnv {
  readonly DEV: boolean
  readonly PROD: boolean
  readonly MODE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare const __GERMANY_TILES_AVAILABLE__: boolean
declare const __GERMANY_PMTILES_AVAILABLE__: boolean