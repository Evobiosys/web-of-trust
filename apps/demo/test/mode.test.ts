import { afterEach, describe, expect, it, vi } from 'vitest'
import { wotMode } from '../src/mode'

// `wotMode()` reads `import.meta.env.VITE_WOT_MODE` on every call rather than
// caching it, so `vi.stubEnv` (which vitest proxies into `import.meta.env`
// for VITE_-prefixed names, not just `process.env`) is enough to exercise
// both branches without a build step.

describe('wotMode', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('defaults to qr when VITE_WOT_MODE is unset -- demo 1s exact build', () => {
    vi.stubEnv('VITE_WOT_MODE', undefined as unknown as string)
    expect(wotMode()).toBe('qr')
  })

  it('is relay only when VITE_WOT_MODE is exactly "relay"', () => {
    vi.stubEnv('VITE_WOT_MODE', 'relay')
    expect(wotMode()).toBe('relay')
  })

  it('is webrtc only when VITE_WOT_MODE is exactly "webrtc" -- demo 3', () => {
    vi.stubEnv('VITE_WOT_MODE', 'webrtc')
    expect(wotMode()).toBe('webrtc')
  })

  it('is ladder only when VITE_WOT_MODE is exactly "ladder" -- demo 6', () => {
    vi.stubEnv('VITE_WOT_MODE', 'ladder')
    expect(wotMode()).toBe('ladder')
  })

  it('falls back to qr for any other value (typo-safe, never silently on)', () => {
    for (const bad of ['Relay', 'RELAY', 'true', '1', 'qr', ' relay', 'relay ', 'Webrtc', 'WEBRTC', 'Ladder', ' webrtc']) {
      vi.stubEnv('VITE_WOT_MODE', bad)
      expect(wotMode()).toBe('qr')
    }
  })
})
