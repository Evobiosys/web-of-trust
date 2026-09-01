import jsQR from 'jsqr'

export type ScanStop = () => void

export interface ScanHandle {
  stop: ScanStop
  /** Rejects if the camera could not be opened at all. */
  ready: Promise<void>
}

/**
 * Continuously scan a <video> element for a QR code.
 *
 * Notes learned the hard way and worth keeping:
 *  - iOS Safari REQUIRES a secure context (https or localhost) for getUserMedia.
 *    On a plain http:// LAN address the camera silently does not exist.
 *  - iOS also requires `playsInline`, or the video takes over the whole screen.
 *  - `facingMode: 'environment'` is a hint, not a guarantee, on desktop.
 */
export function scanQr(video: HTMLVideoElement, onFound: (text: string) => void): ScanHandle {
  let stopped = false
  let stream: MediaStream | null = null
  let raf = 0
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  const stop: ScanStop = () => {
    stopped = true
    if (raf) cancelAnimationFrame(raf)
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
  }

  const ready = (async () => {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 1280 } },
      audio: false,
    })
    if (stopped) { stream.getTracks().forEach((t) => t.stop()); return }
    video.srcObject = stream
    video.setAttribute('playsinline', '')
    video.muted = true
    await video.play()

    const tick = () => {
      if (stopped) return
      if (ctx && video.readyState === video.HAVE_ENOUGH_DATA) {
        const w = video.videoWidth
        const h = video.videoHeight
        if (w && h) {
          // Downscale: jsQR on a full 1280px frame is slow enough to drop the
          // frame rate below what feels responsive when aiming at a screen.
          const scale = Math.min(1, 640 / Math.max(w, h))
          canvas.width = Math.round(w * scale)
          canvas.height = Math.round(h * scale)
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
          const found = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })
          if (found?.data) {
            stop()
            onFound(found.data)
            return
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
  })()

  return { stop, ready }
}

export function cameraPlausible(): boolean {
  return Boolean(navigator.mediaDevices?.getUserMedia) && window.isSecureContext
}
