/**
 * Capture the demo's key screens for visual verification.
 *
 * Headless, phone viewport, no window opened. Writes PNGs into overnight/screens/.
 *   WOT_URL=https://idea2.site/wot-demo/ node test/e2e/screenshots.mjs
 */
const { chromium } = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')
import { mkdir } from 'node:fs/promises'

const URL = process.env.WOT_URL || 'http://127.0.0.1:5180/'
const OUT = process.env.WOT_SHOTS ||
  new URL('../../../../../overnight/screens/', import.meta.url).pathname
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'de-AT' }

const shot = (page, name) => page.screenshot({ path: OUT + name + '.png', fullPage: true })

const dev = async (browser, persona, scheme) => {
  const ctx = await browser.newContext({ ...PHONE, colorScheme: scheme })
  const page = await ctx.newPage()
  await page.goto(URL, { waitUntil: 'networkidle' })
  if (persona) {
    await page.getByRole('button', { name: new RegExp(`als ${persona}`, 'i') }).click()
    await page.waitForSelector('text=Vertrauensnetz')
  }
  return page
}

const run = async () => {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch({ headless: true })

  const start = await dev(browser, null, 'dark')
  await shot(start, '01-start-dark')
  const startLight = await dev(browser, null, 'light')
  await shot(startLight, '01-start-light')

  const m = await dev(browser, 'Marlene', 'dark')
  await shot(m, '02-home')
  await m.getByRole('button', { name: /^Meine Chats/ }).click()
  await shot(m, '03-chats-optout')
  await m.getByRole('button', { name: /^Zurück$/ }).first().click()

  const n = await dev(browser, 'Nora', 'dark')
  await n.getByRole('button', { name: /^Fragen$/ }).click()
  await shot(n, '04-ask-templates')
  await n.locator('.card').filter({ hasText: /Wohnung|frei/i }).first()
    .getByRole('button', { name: /^Frage zeigen$/ }).click()
  await n.waitForSelector('.qrwrap[data-payload]')
  await shot(n, '05-query-qr')
  const q = await n.getAttribute('.qrwrap[data-payload]', 'data-payload')

  await m.getByRole('button', { name: /^Anfrage beantworten$/ }).click()
  await m.getByRole('button', { name: /^Frage scannen$/ }).click()
  await m.locator('textarea').fill(q)
  await m.getByRole('button', { name: /^Code verwenden$/ }).click()
  await m.waitForSelector('.card')
  await shot(m, '06-consent')
  await m.getByRole('button', { name: /^Zeigen, was geteilt würde$/ }).click()
  await m.waitForSelector('.quote')
  await shot(m, '07-consent-revealed')
  await m.getByRole('button', { name: /^Ja, teilen$/ }).click()
  await m.waitForSelector('.qrwrap[data-payload]')
  await shot(m, '08-answer-qr')
  const a = await m.getAttribute('.qrwrap[data-payload]', 'data-payload')

  await n.getByRole('button', { name: /^Antwort scannen$/ }).click()
  await n.locator('textarea').fill(a)
  await n.getByRole('button', { name: /^Code verwenden$/ }).click()
  await n.waitForSelector('.outcome')
  await shot(n, '09-result-shared')

  // The decline outcome, which is the one that carries the argument.
  const n2 = await dev(browser, 'Nora', 'dark')
  const m2 = await dev(browser, 'Marlene', 'dark')
  await n2.getByRole('button', { name: /^Fragen$/ }).click()
  await n2.locator('.card').filter({ hasText: /Wohnung|frei/i }).first()
    .getByRole('button', { name: /^Frage zeigen$/ }).click()
  await n2.waitForSelector('.qrwrap[data-payload]')
  const q2 = await n2.getAttribute('.qrwrap[data-payload]', 'data-payload')
  await m2.getByRole('button', { name: /^Anfrage beantworten$/ }).click()
  await m2.getByRole('button', { name: /^Frage scannen$/ }).click()
  await m2.locator('textarea').fill(q2)
  await m2.getByRole('button', { name: /^Code verwenden$/ }).click()
  await m2.waitForSelector('.card')
  await m2.getByRole('button', { name: /^Nein$/ }).click()
  await m2.waitForSelector('.qrwrap[data-payload]')
  const a2 = await m2.getAttribute('.qrwrap[data-payload]', 'data-payload')
  await n2.getByRole('button', { name: /^Antwort scannen$/ }).click()
  await n2.locator('textarea').fill(a2)
  await n2.getByRole('button', { name: /^Code verwenden$/ }).click()
  await n2.waitForSelector('.outcome')
  await shot(n2, '10-result-nothing')

  // English toggle, to prove it is real.
  await n2.getByRole('button', { name: /Sprache wechseln/i }).click()
  await shot(n2, '11-english')

  await browser.close()
  console.log('screenshots written to ' + OUT)
}

run().catch((e) => { console.error('SHOTS FAILED:', e); process.exit(1) })
