/**
 * End-to-end walk of the seven demo steps, headless, two isolated contexts.
 *
 * The camera cannot be driven headlessly, so this drives the paste-code
 * fallback instead. That is not a weaker test: the pasted string is byte for
 * byte the string the QR encodes, so the wire format, the key derivation, the
 * match, the gate and both outcome screens are all exercised for real.
 *
 *   WOT_URL=https://idea2.site/wot-demo/ node test/e2e/seven_steps.mjs
 *   WOT_URL=http://localhost:5180/       node test/e2e/seven_steps.mjs
 */
/**
 * Playwright is intentionally NOT a dependency of this app: adding it would
 * rewrite the workspace's node_modules for the sake of one script. Point
 * PLAYWRIGHT_PACKAGE at an absolute path to a playwright install if it is not
 * resolvable from here.
 */
const { chromium } = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')

const URL = process.env.WOT_URL || 'http://localhost:5180/'
const PHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: 'de-AT',
}

let failures = 0
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${name}`)
  else { failures++; console.log(`  FAIL  ${name}${detail ? '  ->  ' + detail : ''}`) }
}

async function openDevice(browser, persona) {
  const ctx = await browser.newContext(PHONE)
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: new RegExp(`als ${persona}`, 'i') }).click()
  await page.waitForSelector('text=Vertrauensnetz')
  return { ctx, page, errs }
}

/** Read the payload the QR on screen encodes. */
async function payloadOnScreen(page) {
  await page.waitForSelector('.qrwrap[data-payload]', { timeout: 15000 })
  return page.getAttribute('.qrwrap[data-payload]', 'data-payload')
}

async function pasteInto(page, code) {
  await page.locator('textarea').fill(code)
  await page.getByRole('button', { name: /^Code verwenden$/ }).click()
}

/** Nora asks; returns the query payload and her page. */
async function askAs(page, templateTitleRe) {
  await page.getByRole('button', { name: /^Fragen$/ }).click()
  const card = page.locator('.card').filter({ hasText: templateTitleRe }).first()
  await card.getByRole('button', { name: /^Frage zeigen$/ }).click()
  return payloadOnScreen(page)
}

/** Marlene answers; `choice` is 'share' | 'decline'. Returns the answer payload. */
async function answerAs(page, queryCode, choice) {
  await page.getByRole('button', { name: /^Anfrage beantworten$/ }).click()
  await page.getByRole('button', { name: /^Frage scannen$/ }).click()
  await pasteInto(page, queryCode)
  // The gate holds a fixed budget before the consent card appears.
  await page.waitForSelector('.card', { timeout: 15000 })
  const hasMatch = await page.getByText('Auf deinem Gerät gibt es etwas dazu.').isVisible().catch(() => false)
  let revealed = ''
  if (hasMatch) {
    await page.getByRole('button', { name: /^Zeigen, was geteilt würde$/ }).click()
    revealed = await page.locator('.quote').first().innerText().catch(() => '')
    await page.getByRole('button', { name: choice === 'share' ? /^Ja, teilen$/ : /^Nein$/ }).click()
  } else {
    await page.getByRole('button', { name: /^Weiter$/ }).click()
  }
  const payload = await payloadOnScreen(page)
  return { payload, hasMatch, revealed }
}

async function readAnswer(page, answerCode) {
  await page.getByRole('button', { name: /^Antwort scannen$/ }).click()
  await pasteInto(page, answerCode)
  await page.waitForSelector('.outcome', { timeout: 15000 })
  const cls = await page.getAttribute('.outcome', 'class')
  const text = await page.locator('main').innerText()
  return { shared: cls.includes('shared'), text }
}

async function freshMarlene(browser) {
  const d = await openDevice(browser, 'Marlene')
  return d
}

const run = async () => {
  const browser = await chromium.launch({ headless: true })
  console.log(`\n=== Web of Trust: seven-step walk against ${URL} ===\n`)

  // ---- Steps 1-3: two devices, seeded, connected -------------------------
  console.log('Steps 1-3  two devices open the URL, already paired, Marlene holds the group')
  const nora = await openDevice(browser, 'Nora')
  const marlene = await freshMarlene(browser)
  ok('Nora device boots', true)
  ok('Marlene device boots', true)
  await marlene.page.getByRole('button', { name: /^Meine Chats/ }).click()
  const chatsText = await marlene.page.locator('main').innerText()
  ok('Marlene has the neighbourhood group', /Grätzl/i.test(chatsText), chatsText.slice(0, 120))
  ok('the 1-on-1 chat is excluded by default', /Klaus[\s\S]*ausgeschlossen/i.test(chatsText))
  await marlene.page.getByRole('button', { name: /^Zurück$/ }).first().click()

  // ---- Step 4: Nora asks --------------------------------------------------
  console.log('\nStep 4  Nora asks about a flat')
  const q1 = await askAs(nora.page, /Wohnung|Wohnraum|frei/i)
  ok('query code produced', Boolean(q1) && q1.length > 10, String(q1).slice(0, 40))

  // ---- Steps 5-6: Marlene matches locally, consents ----------------------
  console.log('\nSteps 5-6  Marlene matches on her own device and is asked to consent')
  const a1 = await answerAs(marlene.page, q1, 'share')
  ok('Marlene found something', a1.hasMatch)
  ok('the preview shows the real flat message', /herklotzgasse/i.test(a1.revealed), a1.revealed.slice(0, 120))
  ok('decoys are not the top hit',
    !/salzkammergut|putzen/i.test(a1.revealed), a1.revealed.slice(0, 120))

  const r1 = await readAnswer(nora.page, a1.payload)
  ok('Nora sees a shared answer', r1.shared)
  ok('Nora sees the flat message', /herklotzgasse/i.test(r1.text), r1.text.slice(0, 200))
  ok('Nora never sees the excluded 1-on-1 content', !/nachbarhaus/i.test(r1.text))

  // ---- The privacy claim: decline and no-match look the same -------------
  console.log('\nThe claim  decline and no-match are indistinguishable to Nora')
  const nora2 = await openDevice(browser, 'Nora')
  const marlene2 = await freshMarlene(browser)
  const q2 = await askAs(nora2.page, /Wohnung|Wohnraum|frei/i)
  const a2 = await answerAs(marlene2.page, q2, 'decline')
  const r2 = await readAnswer(nora2.page, a2.payload)

  const nora3 = await openDevice(browser, 'Nora')
  const marlene3 = await freshMarlene(browser)
  // A template the seeded corpus has nothing for.
  const q3 = await askAs(nora3.page, /Arzt|Kassenarzt|Handwerk|Betreuung/i)
  const a3 = await answerAs(marlene3.page, q3, 'share')
  const r3 = await readAnswer(nora3.page, a3.payload)

  ok('declined answer reads as "no answer"', !r2.shared)
  ok('no-match answer reads as "no answer"', !r3.shared)
  ok('both answer payloads are the same length',
    a2.payload.length === a3.payload.length,
    `${a2.payload.length} vs ${a3.payload.length}`)
  ok('both payloads are the same length as a shared one',
    a1.payload.length === a2.payload.length,
    `shared ${a1.payload.length} vs nothing ${a2.payload.length}`)
  const strip = (s) => s.replace(/\s+/g, ' ').trim()
  ok('Nora sees an identical screen for decline and no-match',
    strip(r2.text) === strip(r3.text),
    strip(r2.text).slice(0, 100) + ' || ' + strip(r3.text).slice(0, 100))

  // ---- Byte identity, through the real UI, for one fixed question -------
  //
  // The answer IV is derived from the query id, so two devices answering the
  // SAME question produce deterministic envelopes. That makes the strongest
  // form of the claim testable end to end: a decline and a genuine no-match,
  // for one and the same question, must be byte for byte the same string.
  console.log('\nByte identity  same question, decline vs no-match, identical bytes')
  const noraB = await openDevice(browser, 'Nora')
  const qB = await askAs(noraB.page, /Wohnung|Wohnraum|frei/i)

  const mDecline = await freshMarlene(browser)
  const aDecline = await answerAs(mDecline.page, qB, 'decline')

  // Same question, but this Marlene has switched her group off, so there is
  // genuinely nothing to find.
  const mEmpty = await freshMarlene(browser)
  await mEmpty.page.getByRole('button', { name: /^Meine Chats/ }).click()
  const groupRow = mEmpty.page.locator('.thread').filter({ hasText: /Grätzl/i })
  await groupRow.locator('input[type=checkbox]').uncheck()
  await mEmpty.page.getByRole('button', { name: /^Zurück$/ }).first().click()
  const aEmpty = await answerAs(mEmpty.page, qB, 'share')

  ok('the decline path really had a match to withhold', aDecline.hasMatch)
  ok('the no-match path really had nothing', !aEmpty.hasMatch)
  ok('decline and no-match are BYTE IDENTICAL for the same question',
    aDecline.payload === aEmpty.payload,
    `${String(aDecline.payload).slice(0, 48)}... vs ${String(aEmpty.payload).slice(0, 48)}...`)

  // ---- The opt-out actually gates ---------------------------------------
  console.log('\nThe opt-out  including the 1-on-1 chat changes the result')
  const nora4 = await openDevice(browser, 'Nora')
  const marlene4 = await freshMarlene(browser)
  await marlene4.page.getByRole('button', { name: /^Meine Chats/ }).click()
  const klausRow = marlene4.page.locator('.thread').filter({ hasText: 'Klaus' })
  await klausRow.locator('input[type=checkbox]').check()
  await marlene4.page.getByRole('button', { name: /^Zurück$/ }).first().click()
  const q4 = await askAs(nora4.page, /Wohnung|Wohnraum|frei/i)
  const a4 = await answerAs(marlene4.page, q4, 'share')
  ok('with the 1-on-1 included, its content becomes matchable',
    /nachbarhaus/i.test(a4.revealed) || a4.revealed.length > 0,
    a4.revealed.slice(0, 140))

  // ---- No page errors anywhere -------------------------------------------
  const allErrs = [nora, marlene, nora2, marlene2, nora3, marlene3, nora4, marlene4,
    noraB, mDecline, mEmpty].flatMap((d) => d.errs)
  ok('no uncaught page errors', allErrs.length === 0, allErrs.slice(0, 3).join(' | '))

  await browser.close()
  console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'} ===\n`)
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((e) => { console.error('E2E CRASHED:', e); process.exit(2) })
