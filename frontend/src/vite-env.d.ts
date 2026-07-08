/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_KOIOS_API_BASE?: string
  readonly VITE_KOIOS_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
