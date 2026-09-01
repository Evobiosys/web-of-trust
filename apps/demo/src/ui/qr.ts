import QRCode from 'qrcode'

/**
 * Render a payload as a QR canvas.
 *
 * Error-correction level M is deliberate: phone-screen-to-phone-camera scanning
 * has glare and moire, and H would inflate the module count for our payload
 * sizes, making each module smaller and HARDER to scan, not easier.
 */
export async function renderQr(target: HTMLElement, payload: string): Promise<void> {
  target.replaceChildren()
  const canvas = document.createElement('canvas')
  target.appendChild(canvas)
  await QRCode.toCanvas(canvas, payload, {
    errorCorrectionLevel: 'M',
    margin: 2,
    scale: 8,
    color: { dark: '#000000ff', light: '#ffffffff' },
  })
  canvas.style.width = '100%'
  canvas.style.height = 'auto'
}

/**
 * Ask the OS to hold the screen bright and awake while a code is on screen.
 * Scanning a dim phone screen is the single most common demo failure.
 */
export async function keepAwake(): Promise<() => void> {
  type Sentinel = { release(): Promise<void> }
  const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<Sentinel> } }
  if (!nav.wakeLock) return () => {}
  try {
    const s = await nav.wakeLock.request('screen')
    return () => { void s.release() }
  } catch {
    return () => {}
  }
}
