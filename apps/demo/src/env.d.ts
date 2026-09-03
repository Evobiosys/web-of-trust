/// <reference types="vite/client" />

/**
 * Build-time override for the relay origin (relay.ts). Unset in normal
 * deployment -- the relay has no CORS headers, so the real default is
 * "wherever this page is being served from" (location.origin), which is
 * questhub.eco once deployed there. This exists for local development
 * against a different relay instance.
 */
interface ImportMetaEnv {
  readonly VITE_RELAY_ORIGIN?: string
}

declare module '*?raw' {
  const content: string
  export default content
}

/**
 * `qrcode` ships no type declarations and `@types/qrcode` is a separate package.
 * Declaring the one function this app uses keeps the dependency tree unchanged,
 * which matters on a night when three agents are running tests against this
 * workspace. If more of the API is ever needed, install @types/qrcode instead of
 * growing this block.
 */
declare module 'qrcode' {
  export interface QRCodeToCanvasOptions {
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'
    margin?: number
    scale?: number
    width?: number
    color?: { dark?: string; light?: string }
  }
  export function toCanvas(
    canvas: HTMLCanvasElement,
    text: string,
    options?: QRCodeToCanvasOptions,
  ): Promise<void>
  const _default: { toCanvas: typeof toCanvas }
  export default _default
}
