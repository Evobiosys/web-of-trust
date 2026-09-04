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
  // The one-scan connect link (relay mode, connect_link.ts): a QR encoding a
  // URL, not JSON, so a phone whose camera can only offer to open a link
  // (GrapheneOS -- no separate scanner app) can actually use it. This is
  // the PRIMARY connect affordance in relay mode; the two-scan codes above
  // stay as a fallback.
  showConnectLink: { de: 'Verbindungslink zeigen', en: 'Show connect link' },
  connectLinkExplain: {
    de: 'Ein Link statt eines Codes: die Kamera des anderen Geräts kann ihn direkt öffnen, ganz ohne eigene Scanner-App.',
    en: 'A link instead of a code: the other device’s camera can open it directly, with no separate scanner app.',
  },
  connectLinkHint: {
    de: 'Zeig diesen Code dem anderen Gerät. Es öffnet die Kamera-App und tippt auf den erkannten Link. Kein zweiter Scan in die andere Richtung nötig: das andere Gerät meldet sich von selbst übers Netz zurück.',
    en: 'Show this code to the other device. It opens the camera app and taps the link it recognises. No second scan in the other direction needed: the other device reports back over the network by itself.',
  },
  // The one place THIS ceremony names what the relay does and does not
  // learn -- deliberately a different, and more honest, claim than
  // `relayExplain` below. That one still has to admit "anyone who saw both
  // codes could compute the same key" because the two-scan ceremony derives
  // its key from two plaintext nonces. This ceremony derives its key by
  // real X25519 key agreement (connect_link.ts's module header has the full
  // reasoning): the relay sees both devices' public identifiers, as it must
  // to route anything, but that is not enough to compute the shared key,
  // because that needs a private key that never leaves either device.
  connectLinkHonesty: {
    de: 'Dieser Link enthält nur öffentliche Angaben. Der Vermittlungsserver sieht, welche zwei Geräte sich verbinden, kann den Verbindungsschlüssel selbst aber nicht berechnen: dafür wäre ein privater Schlüssel nötig, der nie das Gerät verlässt. Nicht geprüft: ob der Link unterwegs verändert wurde, bevor er gescannt wurde.',
    en: 'This link contains only public information. The relay server sees which two devices are connecting, but cannot compute the connection key itself: that would need a private key that never leaves the device. Not checked: whether the link was altered before it was scanned.',
  },
  connectLinkEphemeralNote: {
    de: 'Blockiert dieses Gerät dauerhaften Speicher, gilt die Verbindung nur für diesen Besuch.',
    en: 'If this device blocks persistent storage, the connection lasts only for this visit.',
  },
  connectedWith:  { de: 'Verbunden mit', en: 'Connected with' },
  noConnection:   { de: 'Noch nicht verbunden.', en: 'Not connected yet.' },
  // Said after a scan actually worked. The camera view used to just close,
  // which from the phone in your hand looks exactly like a crash.
  scanOkTitle:    { de: 'Code übernommen', en: 'Code accepted' },
  // The live-link screen: a probe and a conversation, so "Verbunden seit …"
  // stops being a claim the person has to take on faith.
  navLink:        { de: 'Verbindung prüfen', en: 'Check the connection' },
  navChatNow:     { de: 'Jetzt schreiben', en: 'Write now' },
  linkNowConnected: { de: 'Verbunden', en: 'Connected' },
  netGrew:        { de: 'Dein Netz', en: 'Your web' },
  netPeople:      { de: 'Personen', en: 'people' },
  invitedBy:      { de: 'Eine Einladung von', en: 'An invitation from' },
  invitedByNote:  {
    de: 'Der Link, den du geöffnet hast, verbindet dich mit diesem Gerät. Wähl unten aus, wer du in dieser Demo sein willst, dann steht die Verbindung von selbst.',
    en: 'The link you opened connects you with that device. Choose below who you want to be in this demo, and the connection completes by itself.',
  },
  connectPairTitle:   { de: 'Einander kennenlernen', en: 'Get to know each other' },
  connectPairExplain: {
    de: 'Einmal einen Code austauschen, damit die Geräte wissen, wer der andere ist. Das ist noch keine laufende Verbindung, sondern die Grundlage dafür.',
    en: 'Exchange a code once so the devices know who the other is. This is not yet a running connection, it is what one is built on.',
  },
  webrtcSteps: {
    de: 'Es gibt hier keine Geräteliste und kein Suchen. Drei Schritte: 1. ein Gerät tippt „Verbindung anbieten“ und zeigt seinen Code. 2. das andere tippt „Verbindung annehmen“, scannt ihn und zeigt daraufhin seine Antwort. 3. das erste Gerät scannt diese Antwort. Danach läuft die Verbindung direkt zwischen den beiden.',
    en: 'There is no device list and no searching here. Three steps: 1. one device taps "Offer a connection" and shows its code. 2. the other taps "Accept a connection", scans it, and then shows its answer. 3. the first device scans that answer. After that the two are connected directly.',
  },
  showMyCodeFootnote: {
    de: 'Ein gezeigter Code allein verbindet noch nichts. Entweder das andere Gerät meldet sich von selbst zurück, oder ihr scannt hier seinen Code.',
    en: 'Showing a code connects nothing by itself. Either the other device reports back on its own, or you scan its code here.',
  },
  linkLead:       { de: 'Hier siehst du, ob die Verbindung wirklich steht. Drück auf Prüfen, oder tipp etwas und schau auf das andere Gerät.', en: 'This is where you see whether the connection is really up. Press test, or type something and look at the other device.' },
  linkTestBtn:    { de: 'Verbindung prüfen', en: 'Test the connection' },
  linkTesting:    { de: 'Läuft …', en: 'Testing …' },
  linkTestOk:     { de: 'Die Verbindung steht', en: 'The connection is up' },
  linkTestFailed: { de: 'Keine Antwort vom anderen Gerät. Ist es offen und auf derselben Demo?', en: 'No answer from the other device. Is it open, on the same demo?' },
  linkViaDirect:  { de: 'direkt von Gerät zu Gerät', en: 'directly, device to device' },
  linkViaServer:  { de: 'über den Server', en: 'via the server' },
  linkChatTitle:  { de: 'Nachrichten', en: 'Messages' },
  linkPlaceholder:{ de: 'Tipp etwas und schau aufs andere Gerät', en: 'Type something, then look at the other device' },
  linkSendBtn:    { de: 'Senden', en: 'Send' },
  linkSendFailed: { de: 'Nicht gesendet:', en: 'Not sent:' },
  linkEmpty:      { de: 'Noch nichts geschrieben.', en: 'Nothing written yet.' },
  linkMe:         { de: 'Ich', en: 'Me' },
  // The chat's own small info button (chat-signal handover, item 3): opens
  // whichever of relayExplain/webrtcExplain below actually applies to the
  // channel this conversation is using right now. Never a new security
  // claim of its own -- see main.ts's screenLink().
  chatInfoBtn:    { de: 'Wie ist das gesichert?', en: 'How is this secured?' },
  // The "what was shared" chat bubble's header: "<Frage-Titel> geteilt",
  // e.g. "Bleibt euch die Wohnung offen? geteilt" reads oddly, so main.ts
  // builds it as "<Template-Titel> " + this word, e.g. "Wohnung geteilt" for
  // demo 20's own template title. Kept as one short word, not a full
  // sentence, so it composes with every template's title.
  chatSharedLabel: { de: 'geteilt', en: 'shared' },
  // Shown between catching a code and knowing whether it worked. Accepting a
  // WebRTC offer gathers ICE first, which takes seconds; the camera is already
  // stopped by then, so without this the screen is a dead black rectangle.
  scanCaught:     { de: 'Code erkannt. Einen Moment …', en: 'Code caught. One moment …' },
  scanFailed:     { de: 'Das hat nicht geklappt:', en: 'That did not work:' },
  scanOkWith:     { de: 'Verbunden mit', en: 'Connected with' },
  scanOkNext:     {
    de: 'Auf dem anderen Gerät ist noch nichts zu sehen: In dieser Betriebsart geht nichts über ein Netz, also kann es nicht wissen, dass sein Code gelesen wurde. Zeig jetzt deinen Code her, damit die andere Seite ihn scannt. Dann sind beide sicher.',
    en: 'The other device still shows nothing: in this mode nothing travels over a network, so it cannot know its code was read. Show your own code now so the other side can scan it. Then both of you are sure.',
  },
  // Said instead of connectedWith while the pairing came from the demo seed.
  // Plain words only: an earlier draft said "vorgekoppelt", which is not a
  // word anyone uses, and the disclosure is worthless if the reader has to
  // decode it.
  seededWith:     { de: 'Voreingestellt:', en: 'Pre-set:' },
  seededNote:     {
    de: 'Diese Verbindung hat die Demo selbst eingetragen, damit ihr sofort loslegen könnt. Ihr habt einander noch keinen Code gezeigt. Wenn ihr das nachholen wollt: unter „Verbinden“ zeigt ein Gerät seinen Code, das andere scannt ihn.',
    en: 'The demo entered this connection itself so you can start straight away. You have not shown each other a code yet. To do it for real: under "Connect", one device shows its code and the other scans it.',
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
  // relay mode: connection status, waiting states, errors
  relayConnecting: { de: 'Verbindet…', en: 'Connecting…' },
  relayConnected:  { de: 'Verbunden', en: 'Connected' },
  relayDisconnected: { de: 'Getrennt', en: 'Disconnected' },
  relaySince:      { de: 'seit', en: 'since' },
  relayNoPeerDid:  {
    de: 'Ihr habt noch keine Verbindung übers Netz. Tauscht zuerst die Codes unter „Verbinden“.',
    en: 'You do not have a network connection yet. Exchange codes under "Connect" first.',
  },
  relayGoConnect:  { de: 'Zu „Verbinden“', en: 'Go to "Connect"' },
  relayAskInFlight: { de: 'Frage unterwegs…', en: 'Question on its way…' },
  relayWaitingQuery: { de: 'Warte auf eine Frage übers Netz…', en: 'Waiting for a question over the network…' },
  relayAnswerSent: { de: 'Antwort gesendet', en: 'Answer sent' },
  relayAnswerSentSub: {
    de: 'Die Antwort ist unterwegs zum fragenden Gerät.',
    en: 'The answer is on its way to the asking device.',
  },
  relayTimeout:    {
    de: 'Keine Antwort übers Netz. Der Relay ist entweder nicht erreichbar, oder die Gegenseite hat noch nicht reagiert.',
    en: 'No answer over the network. Either the relay is unreachable, or the other side has not responded yet.',
  },
  relaySendFailed: { de: 'Senden über das Netz ist fehlgeschlagen.', en: 'Sending over the network failed.' },
  retry:           { de: 'Erneut versuchen', en: 'Retry' },
  showQrInstead:   { de: 'Code stattdessen zeigen', en: 'Show code instead' },
  scanInstead:     { de: 'Code stattdessen scannen', en: 'Scan code instead' },
  // The one place this app names what the relay does and does not learn.
  // Three clauses, all of them load-bearing: it cannot read the content
  // (the key never crossed the relay); it DOES see who talks to whom and
  // when (traffic metadata, not nothing); and the pairing itself is not an
  // authenticated exchange, so anyone who saw both connect-codes could
  // compute the same key. Dropping any one of the three overclaims.
  relayExplain:    {
    de: 'Fragen und Antworten laufen jetzt über einen Vermittlungsserver statt über den Code. Er kann den Inhalt nicht lesen: der Schlüssel dafür wurde nur beim Verbinden zwischen euren Geräten ausgetauscht, nie an ihn geschickt. Er sieht aber, wer mit wem und wann etwas schickt. Und: das Verbinden selbst ist nicht gegenseitig geprüft, wer beide Codes beim Verbinden gesehen hat, könnte denselben Schlüssel berechnen.',
    en: 'Questions and answers now travel through a relay server instead of the code. It cannot read the content: the key for that was only exchanged between your devices while connecting, never sent to it. It does see who sends something to whom, and when. And: the connection itself is not mutually verified, anyone who saw both codes while you connected could compute the same key.',
  },

  // webrtc mode (demo 3): the data-channel ceremony -- two QR codes open a
  // direct channel, no server in the path. See webrtc.ts's module doc for
  // exactly what this rung does and does not protect.
  webrtcCardTitle: { de: 'Direktverbindung (WebRTC)', en: 'Direct connection (WebRTC)' },
  webrtcExplain: {
    de: 'Hier laufen Frage und Antwort direkt zwischen euren Geräten, ganz ohne Server. Der Aufbau braucht zwei Codes: einer bietet an, der andere nimmt an. Danach reist alles über diese Verbindung, ohne weiteres Scannen. Was das nicht schützt: eure Geräte lernen die lokale Netzadresse der Gegenseite, wie beim Verbinden im selben Raum, und wer im selben WLAN mitschneidet, sieht Zeitpunkt und Größe der Datenpakete, auch wenn er den Inhalt nicht lesen kann. Über getrennte Netze (z. B. Mobilfunk zu WLAN) funktioniert das meist nicht, weil dafür ein Vermittlungsserver nötig wäre, den es hier nicht gibt.',
    en: 'Here questions and answers travel directly between your devices, with no server at all. Setting it up takes two codes: one side offers, the other accepts. After that everything travels over this connection, no more scanning. What this does not protect: your devices learn each other’s local network address, the same as connecting in the same room, and anyone recording traffic on the same Wi-Fi sees the timing and size of the packets, even without reading the content. Across separate networks (say, mobile data to Wi-Fi) this usually will not work, because that needs a relay server, which does not exist here.',
  },
  webrtcOfferBtn: { de: 'Verbindung anbieten', en: 'Offer a connection' },
  webrtcAcceptBtn: { de: 'Verbindung annehmen', en: 'Accept a connection' },
  webrtcShowOffer: { de: 'Mein Angebot zeigen', en: 'Show my offer' },
  webrtcOfferHint: { de: 'Halte diesen Code vor das andere Gerät. Es scannt ihn und zeigt dir seine Antwort zurück.',
                      en: 'Hold this code up to the other device. It scans it and shows you its answer in return.' },
  webrtcScanAnswer: { de: 'Antwort scannen', en: 'Scan the answer' },
  webrtcScanOffer: { de: 'Angebot scannen', en: 'Scan the offer' },
  webrtcShowAnswer: { de: 'Meine Antwort zeigen', en: 'Show my answer' },
  webrtcAnswerHint: { de: 'Halte diesen Code vor das anbietende Gerät.', en: 'Hold this code up to the offering device.' },
  webrtcAnswerDone: { de: 'Verbindung prüfen', en: 'Check the connection' },
  webrtcGathering: { de: 'Bereite Angebot vor…', en: 'Preparing the offer…' },
  webrtcConnecting: { de: 'Baue Direktverbindung auf…', en: 'Building the direct connection…' },
  webrtcOpen: { de: 'Verbunden, kein Server beteiligt.', en: 'Connected, no server involved.' },
  webrtcFailedTitle: { de: 'Direktverbindung nicht zustande gekommen', en: 'Direct connection did not come together' },
  webrtcFailedBody: {
    de: 'Das kommt vor, wenn die Geräte nicht im selben Netz sind, das WLAN Geräte gegeneinander abschottet, oder eine Firewall dazwischenfunkt. Ohne eigenen Vermittlungsserver kann diese Betriebsart das nicht umgehen.',
    en: 'This happens when the devices are not on the same network, the Wi-Fi isolates devices from each other, or a firewall gets in the way. Without its own relay server this mode cannot work around that.',
  },
  webrtcTryServer: { de: 'Über den Server versuchen', en: 'Try over the server' },
  webrtcBackToConnect: { de: 'Zurück zu „Verbinden“', en: 'Back to "Connect"' },
  webrtcAskInFlight: { de: 'Frage unterwegs, direkt zum anderen Gerät…', en: 'Question on its way, directly to the other device…' },
  webrtcTimeout: {
    de: 'Keine Antwort über die Direktverbindung. Der Datenkanal kann in der Zwischenzeit abgebrochen sein.',
    en: 'No answer over the direct connection. The data channel may have dropped in the meantime.',
  },

  // ladder mode (demo 6): same webrtc ceremony as demo 3, but ask/answer try
  // it automatically and fall to the relay on failure -- the visible rung
  // indicator IS the demo.
  ladderExplain: {
    de: 'Diese Vorführung probiert zuerst die Direktverbindung ohne Server. Klappt das nicht oder bricht ab, wechselt sie von selbst auf den Vermittlungsserver aus Demo 2, und du siehst, welche Stufe gerade läuft.',
    en: 'This demo tries the direct, server-free connection first. If that does not work or drops, it switches on its own to the relay server from demo 2, and you can see which rung is currently in use.',
  },
  rungWebrtc: { de: 'Stufe 2 · WebRTC · kein Server', en: 'Rung 2 · WebRTC · no server' },
  rungRelay: { de: 'Stufe 3 · über den Server', en: 'Rung 3 · over the server' },
  rungRelayAfterWebrtc: { de: 'Stufe 3 · über den Server (Direktverbindung war nicht erreichbar)',
                           en: 'Rung 3 · over the server (direct connection was not reachable)' },
  rungQr: { de: 'Stufe 1 · nur QR-Code', en: 'Rung 1 · QR code only' },

  // demo 20 (geologengasse scenario, mode.ts's wotScenario()): the owner's
  // own flat, his own web of trust. Every key below is used only when
  // wotScenario() === 'geologengasse' -- unreferenced in demos 1/2/3/6.
  geoInvitedNote: {
    de: 'Der Link, den du geöffnet hast, verbindet dich mit diesem Gerät. Gib deinen Namen ein, dann schickst du eine Anfrage. Verbunden bist du erst, wenn die andere Seite sie bestätigt.',
    en: 'The link you opened connects you with this device. Enter your name, then you send a request. You are only connected once the other side confirms it.',
  },
  geoNameTitle:   { de: 'Wie heißt du?', en: 'What is your name?' },
  geoNamePh:      { de: 'Dein Name', en: 'Your name' },
  geoNameSend:    { de: 'Anfrage senden', en: 'Send request' },
  geoRequestSentTitle: { de: 'Anfrage gesendet', en: 'Request sent' },
  geoRequestSentBody: {
    de: 'Die andere Seite muss die Anfrage noch bestätigen. Sobald das passiert, seid ihr verbunden.',
    en: 'The other side still has to confirm the request. Once that happens, you are connected.',
  },
  // The laptop's pending-request card: default is NOT accepted, and it must
  // stay visibly waiting until Jakob taps the confirm button. Nobody joins
  // his graph without that tap.
  geoPendingTitle: { de: 'Anfrage wartet', en: 'Request waiting' },
  geoPendingBody: {
    de: 'möchte sich mit dir verbinden. Noch nicht bestätigt, noch nicht in deinem Netz.',
    en: 'wants to connect with you. Not confirmed yet, not in your network yet.',
  },
  geoAcceptBtn:   { de: 'Anfrage bestätigen', en: 'Confirm request' },
  geoDeclineBtn:  { de: 'Ablehnen', en: 'Decline' },
  geoAcceptedTitle: { de: 'Verbunden', en: 'Connected' },
  geoAcceptedBody: { de: 'ist jetzt in deinem Netz.', en: 'is now in your network.' },
  geoGraphNav:    { de: 'Mein Netz', en: 'My network' },
  geoNetworkCount: { de: 'Personen in deinem Netz', en: 'people in your network' },
  geoNetworkCountOne: { de: 'Person in deinem Netz', en: 'person in your network' },
  geoGraphTitle:  { de: 'Vertrauensnetz', en: 'Trust network' },
  geoGraphLead: {
    de: 'Wer wen kennt, und wie nah. Der Abstand hier bedeutet etwas: ein Ring weiter heißt, du kennst die Person nur über jemand anderen.',
    en: 'Who knows whom, and how closely. The distance here means something: one ring further out means you only know that person through someone else.',
  },
  geoGraphYou:    { de: 'Jakob', en: 'Jakob' },
  geoGraphUnknownNote: {
    de: 'Steht für jemanden, den du noch nicht kennst.', en: 'Stands for someone you do not know yet.',
  },
  geoGraphRing2Note: {
    de: 'Zwei Ringe entfernt: kennst du nur über Alex, nicht direkt.',
    en: 'Two rings out: you only know this person through Alex, not directly.',
  },
  // The demo-crutch k-threshold, said plainly rather than left implicit --
  // see match/accommodation.ts's own comment on why k=1 here is not an
  // anonymity floor.
  geoKHonesty: {
    de: 'Für diese Vorführung: Der Datensatz ist eine einzige Wohnung, darum reicht hier schon eine Übereinstimmung. Das übliche Anonymitäts-Minimum aus mehreren Personen greift hier nicht.',
    en: 'For this demo: the dataset is a single flat, so one match is enough here. The usual anonymity floor across several people does not apply here.',
  },
  // The honest chaining limit -- read docs/query-traversal.md before ever
  // touching this string. A third person paired to the invited phone can
  // query THAT PHONE, never Jakob through it: hop 2 exists in
  // packages/agent-daemon but not in this demo app.
  geoNextQuery:   { de: 'Nächste Anfrage', en: 'Next request' },
  geoChainHonesty: {
    de: 'Wichtig: Wer über diesen Link dazukommt, kann nur dieses Gerät fragen, nicht dich. Eine Frage geht in dieser Vorführung nie einen Schritt weiter, egal wie oft der Link weitergegeben wird.',
    en: 'Important: whoever joins through this link can only query THIS device, never you. In this demo a question never travels one hop further, no matter how many times the link is passed on.',
  },
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
