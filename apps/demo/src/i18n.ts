/** Two-language string table. German is the source language; English is the toggle. */

export type Lang = 'de' | 'en'

const STORE_KEY = 'wot.lang'

export function currentLang(): Lang {
  try {
    const v = localStorage.getItem(STORE_KEY)
    if (v === 'de' || v === 'en') return v
  } catch { /* private mode, fall through */ }
  return navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'de'
}

export function setLang(l: Lang): void {
  try { localStorage.setItem(STORE_KEY, l) } catch { /* ignore */ }
  document.documentElement.lang = l
}

type Table = Record<string, { de: string; en: string }>

const S: Table = {
  appName:        { de: 'Vertrauensnetz', en: 'Web of Trust' },

  // start
  whoAreYou:      { de: 'Wer bist du?', en: 'Who are you?' },
  pickPersona:    { de: 'Für die Demo: wähle ein Gerät. Alles bleibt auf diesem Gerät.',
                    en: 'For the demo: pick a device. Everything stays on this device.' },
  continueAs:     { de: 'Weiter als', en: 'Continue as' },

  // nav
  navChats:       { de: 'Meine Chats', en: 'My chats' },
  navProfile:     { de: 'Mein Profil', en: 'My profile' },
  navInventory:   { de: 'Was ich habe', en: 'What I have' },
  navConnect:     { de: 'Verbinden', en: 'Connect' },
  navAsk:         { de: 'Fragen', en: 'Ask' },
  navAnswer:      { de: 'Anfrage beantworten', en: 'Answer a request' },
  back:           { de: 'Zurück', en: 'Back' },
  done:           { de: 'Fertig', en: 'Done' },
  reset:          { de: 'Demo zurücksetzen', en: 'Reset demo' },
  resetConfirm:   { de: 'Alles auf diesem Gerät löschen und neu starten?',
                    en: 'Erase everything on this device and start over?' },

  // chats
  chatsTitle:     { de: 'Meine Chats', en: 'My chats' },
  chatsLead:      { de: 'Diese Chats liegen nur auf diesem Gerät. Du bestimmst, welche für Anfragen sichtbar sind.',
                    en: 'These chats live only on this device. You decide which ones are visible to requests.' },
  groupChats:     { de: 'Gruppen', en: 'Groups' },
  directChats:    { de: 'Einzelchats', en: 'One-to-one chats' },
  directOff:      { de: 'Einzelchats sind standardmäßig ausgeschlossen. Du kannst sie einzeln freigeben.',
                    en: 'One-to-one chats are excluded by default. You can include them individually.' },
  noDirect:       { de: 'Keine Einzelchats importiert.', en: 'No one-to-one chats imported.' },
  importChat:     { de: 'WhatsApp-Chat importieren', en: 'Import a WhatsApp chat' },
  importHow:      { de: 'In WhatsApp: Gruppe öffnen → Gruppenname antippen → „Chat exportieren“ → „Ohne Medien“ → hierher teilen.',
                    en: 'In WhatsApp: open the group → tap the group name → "Export chat" → "Without media" → share it here.' },
  msgCount:       { de: 'Nachrichten', en: 'messages' },
  people:         { de: 'Personen', en: 'people' },
  included:       { de: 'sichtbar für Anfragen', en: 'visible to requests' },
  excluded:       { de: 'ausgeschlossen', en: 'excluded' },
  kindGroup:      { de: 'Gruppe', en: 'Group' },
  kindDirect:     { de: 'Einzelchat', en: 'One-to-one' },
  importFailed:   { de: 'Diese Datei konnte nicht gelesen werden.', en: 'That file could not be read.' },
  importedOk:     { de: 'Importiert', en: 'Imported' },

  // profile
  profileLead:    { de: 'Dieses Profil bleibt auf deinem Gerät. Nichts davon geht an eine Anfrage, außer du stimmst im Moment der Anfrage ausdrücklich zu.',
                    en: 'This profile stays on your device. None of it goes into a request unless you explicitly agree at the moment of the request.' },
  profileName:    { de: 'Anzeigename', en: 'Display name' },
  profileBio:     { de: 'Was mich ausmacht', en: 'About me' },
  profileGraetzl: { de: 'Grätzl', en: 'Neighbourhood' },
  profileLangs:   { de: 'Sprachen', en: 'Languages' },
  profileLangsHint: { de: 'Kommagetrennt', en: 'Comma-separated' },

  // inventory
  inventoryLead:  { de: 'Dinge, die du hast, weißt oder anbieten kannst. Du trägst sie selbst ein, sie zählen bei Anfragen genauso wie deine Chats.',
                    en: 'Things you have, know or can offer. You enter them yourself; they count in requests exactly like your chats.' },
  inventoryEmpty: { de: 'Du hast noch nichts eingetragen.', en: "You haven't entered anything yet." },
  inventoryPh:    { de: 'z. B. Ich krieg mit, wenn bei uns im Haus eine Wohnung frei wird',
                    en: 'e.g. I hear about it when a flat in our building comes free' },
  addEntry:       { de: 'Hinzufügen', en: 'Add' },
  removeEntry:    { de: 'Entfernen', en: 'Remove' },

  // connect
  connectTitle:   { de: 'Verbinden', en: 'Connect' },
  connectLead:    { de: 'Ein Code, einmal gescannt. Danach kennt ihr euch.',
                    en: 'One code, scanned once. After that you know each other.' },
  showMyCode:     { de: 'Meinen Code zeigen', en: 'Show my code' },
  scanTheirCode:  { de: 'Ihren Code scannen', en: 'Scan their code' },
  connectedWith:  { de: 'Verbunden mit', en: 'Connected with' },
  noConnection:   { de: 'Noch nicht verbunden.', en: 'Not connected yet.' },
  // Said instead of connectedWith while the pairing came from the demo seed.
  // "Vorgekoppelt" is deliberately a slightly odd word: it should make someone
  // ask what it means, and the answer is the honest one.
  seededWith:     { de: 'Vorgekoppelt mit', en: 'Pre-paired with' },
  seededNote:     {
    de: 'Für diese Demo voreingestellt. Diese Kopplung ist nicht im Raum entstanden. Über „Verbinden“ könnt ihr sie jetzt wirklich herstellen.',
    en: 'Pre-set for this demo. This pairing was not created in the room. Use "Connect" to make it real.',
  },

  // ask
  askTitle:       { de: 'Was möchtest du wissen?', en: 'What do you want to know?' },
  askLead:        { de: 'Du wählst eine Frage aus. Freitext geht bewusst nicht: die Frage muss so eng sein, dass sie nichts ausforschen kann.',
                    en: 'You pick a question. Free text is deliberately not possible: the question must be narrow enough that it cannot fish for anything.' },
  showQuery:      { de: 'Frage zeigen', en: 'Show the question' },
  showQueryHint:  { de: 'Halte diesen Code vor das andere Gerät.', en: 'Hold this code up to the other device.' },
  waitAnswer:     { de: 'Antwort scannen', en: 'Scan the answer' },

  // answer
  answerTitle:    { de: 'Anfrage beantworten', en: 'Answer a request' },
  scanQuery:      { de: 'Frage scannen', en: 'Scan the question' },
  checking:       { de: 'Wird auf deinem Gerät geprüft…', en: 'Checking on your device…' },
  askedYou:       { de: 'fragt', en: 'asks' },
  foundSomething: { de: 'Auf deinem Gerät gibt es etwas dazu.', en: 'There is something on your device about this.' },
  foundNothing:   { de: 'Auf deinem Gerät gibt es nichts dazu.', en: 'There is nothing on your device about this.' },
  willingShare:   { de: 'Möchtest du teilen, was du hast?', en: 'Are you willing to share what you have?' },
  seeWhat:        { de: 'Zeigen, was geteilt würde', en: 'Show what would be shared' },
  hideWhat:       { de: 'Wieder verbergen', en: 'Hide again' },
  yesShare:       { de: 'Ja, teilen', en: 'Yes, share' },
  noShare:        { de: 'Nein', en: 'No' },
  continueBtn:    { de: 'Weiter', en: 'Continue' },
  showAnswer:     { de: 'Antwort zeigen', en: 'Show the answer' },
  answerHint:     { de: 'Halte diesen Code vor das fragende Gerät.', en: 'Hold this code up to the asking device.' },
  identicalNote:  { de: 'Dieser Code sieht gleich aus, egal wie du dich entschieden hast.',
                    en: 'This code looks the same no matter what you decided.' },

  // outcome
  outShared:      { de: 'Geteilt', en: 'Shared' },
  outSharedSub:   { de: 'hat sich entschieden, das hier zu teilen.', en: 'chose to share this.' },
  outNothing:     { de: 'Keine Antwort', en: 'No answer' },
  outNothingSub:  { de: 'Du erfährst nicht, warum. Ob niemand etwas hatte oder jemand nicht teilen wollte, sieht von hier aus identisch aus.',
                    en: 'You do not learn why. Whether nobody had anything or somebody chose not to share looks identical from here.' },
  fromChat:       { de: 'aus', en: 'from' },

  // camera
  camAsk:         { de: 'Kamera erlauben', en: 'Allow camera' },
  camDenied:      { de: 'Ohne Kamera geht das Scannen nicht. Du kannst den Code auch als Text übertragen.',
                    en: 'Scanning needs the camera. You can also transfer the code as text.' },
  camPaste:       { de: 'Code als Text einfügen', en: 'Paste code as text' },
  copyCode:       { de: 'Code kopieren', en: 'Copy code' },
  copied:         { de: 'Kopiert', en: 'Copied' },
  pasteHere:      { de: 'Code hier einfügen', en: 'Paste the code here' },
  useCode:        { de: 'Code verwenden', en: 'Use code' },
  badCode:        { de: 'Das ist kein gültiger Code.', en: 'That is not a valid code.' },
  wrongCode:      { de: 'Das ist ein Code, aber nicht die erwartete Art.', en: 'That is a code, but not the expected kind.' },
  scanning:       { de: 'Suche Code…', en: 'Looking for a code…' },
}

let lang: Lang = 'de'

export function initI18n(): void {
  lang = currentLang()
  document.documentElement.lang = lang
}

export function getLang(): Lang { return lang }

export function toggleLang(): Lang {
  lang = lang === 'de' ? 'en' : 'de'
  setLang(lang)
  return lang
}

/** Translate. Unknown keys return the key itself so a miss is visible, not silent. */
export function t(key: string): string {
  const e = S[key]
  return e ? e[lang] : key
}
