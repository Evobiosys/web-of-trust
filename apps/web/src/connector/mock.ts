/**
 * MockConnector — implements the Connector seam (packages/contract/src/connector.ts)
 * with seeded data and scripted counterpart behavior (Maria confirms after ~2s,
 * Lucía accepts a borrow after ~1.6s). No backend, no network. The real
 * implementation replaces this class behind the same interface (ADR-1/4/5).
 */
import {
  ActivityItem,
  AppState,
  CeremonyEvent,
  Completion,
  Connector,
  ConnectorActions,
  DEFAULT_GRANT,
  Edge,
  EventRecord,
  Grant,
  HandshakePayload,
  HostForm,
  IntroSuggestion,
  Level,
  LEVEL_LABEL,
  Offer,
  PersonView,
  Thread,
  TIER_LABEL,
  ceremonyReducer,
  eventVisible,
  effectiveLevel,
  initialCeremony,
  offerVisible,
  tryLoanTransition,
} from "@ew/contract";

const ME = "me";
const MY_DID = "did:key:demo-you";
const DID_TO_ID: Record<string, string> = { "did:key:demo-maria": "maria" };

interface Person {
  id: string;
  name: string;
  metContext?: string;
  offer?: string;
  /** the presence dial {YOU-2}: false ⇒ this person NEVER appears in second
   *  rings — absent entirely, no counts (v7 rule; retired WEB-3). */
  dial?: boolean;
}

const PEOPLE: Record<string, Person> = {
  lucia: { id: "lucia", name: "Lucía", metContext: "Wohnungsbörse Neubau · May", offer: "speakers" },
  rafa: { id: "rafa", name: "Rafa", metContext: "Nachbarschaftsfest Yppenplatz · June" },
  tomas: { id: "tomas", name: "Tomás", metContext: "Sperrmüll-Tauschbörse · June" },
  maria: { id: "maria", name: "Maria", metContext: "Nachbarschaftsfest Yppenplatz · today" },
  bruno: { id: "bruno", name: "Bruno" },
  sofia: { id: "sofia", name: "Sofía" },
  nico: { id: "nico", name: "Nico" },
  // Valen proves the absence rule: dial off ⇒ she never renders anywhere,
  // even though Lucía holds her thread.
  valen: { id: "valen", name: "Valen", dial: false },
};

const edge = (o: Partial<Edge> & Pick<Edge, "a" | "b">): Edge => ({
  levelAtoB: "friend",
  levelBtoA: "friend",
  state: "mutual",
  grantAtoB: { ...DEFAULT_GRANT },
  grantBtoA: { ...DEFAULT_GRANT },
  ...o,
});

export class MockConnector implements Connector {
  private listeners = new Set<() => void>();
  private snapshot: AppState;

  /* domain state */
  private name = "You";
  private onboarded = false;
  private guest = false;
  private dialOn = true;
  private ceremony = { ...initialCeremony };
  private advancedOpen = false;
  private grants: Grant = { ...DEFAULT_GRANT };
  private edges: Edge[] = [
    edge({ a: ME, b: "lucia", levelAtoB: "close", levelBtoA: "close" }),
    edge({ a: ME, b: "rafa" }),
    edge({ a: ME, b: "tomas", state: "pending_out" }),
    // Lucía grants Bruno NO view of her second ring ⇒ Bruno cannot see me
    // through her — he renders (his dial is on) but labeled "sees you: no" {WEB-4}
    edge({ a: "lucia", b: "bruno", grantAtoB: { ...DEFAULT_GRANT, secondRingVisible: false } }),
    // Valen's dial is off ⇒ absent from my rings entirely (no count, no residue)
    edge({ a: "lucia", b: "valen" }),
    // maria's circle exists before you meet her — invisible to you until the handshake
    edge({ a: "maria", b: "sofia" }),
    edge({ a: "maria", b: "nico" }),
  ];
  private events: EventRecord[] = [
    { id: "yppenplatz", name: "Nachbarschaftsfest Yppenplatz", meta: "Sun 11:00 · Yppenplatz · Ottakring", tier: "public", steps: 2, hostIds: ["maria"], kind: "other" },
    { id: "wohnboerse", name: "Wohnungsbörse Neubau", meta: "Tue 19:00 · Amerlinghaus · organized by Clara", tier: "public", steps: 2, hostIds: ["lucia"], kind: "other" },
    { id: "sperrmuell", name: "Sperrmüll-Tauschbörse", meta: "Thu 20:30 · Hof, Josefstadt · linked network", tier: "public", steps: 2, hostIds: [], kind: "other", linked: true },
    { id: "kaffeehang", name: "Kaffee & Nachbarschaft", meta: "Sat 16:00 · Café Sperlhof · community hangout", tier: "public", steps: 2, hostIds: [], kind: "hangout" },
    { id: "hausversammlung", name: "Hausversammlung", meta: "Fri 19:00 · location shared with your web · hosted by Maria's building", tier: "friends", steps: 2, hostIds: ["maria"], kind: "other", reachedVia: "Maria", locationGated: true },
  ];
  private offers: Offer[] = [
    { id: "speakers", item: "PA speakers (pair)", description: "Warm full-range pair, battery option — great for courtyard parties and building get-togethers.", ownerId: "lucia", tier: "friends", state: "available" },
    { id: "handcart", item: "Folding hand cart", description: "Sturdy folding cart with rubber wheels — good for hauling boxes up a few flights.", ownerId: "rafa", tier: "friends", state: "available" },
    { id: "boxes", item: "Moving boxes (20, flat-packed)", description: "Your own offering to the web.", ownerId: ME, tier: "friends", state: "available", mine: true },
    { id: "projector", item: "A projector", description: "Bright enough for outdoor night projections.", identityWithheld: true, viaId: "maria", tier: "friends", state: "available" },
  ];
  private activity: ActivityItem[] = [];
  private threads: Thread[] = [
    { personId: "lucia", name: "Lucía", msgs: [
      { who: "them", text: "Bringing the speakers Sunday — can you carry the stands?" },
      { who: "me", text: "Claro! See you at the park 🌞" },
    ] },
  ];
  private intro: IntroSuggestion | null = {
    id: "i1",
    seekerName: "Rafa",
    holderName: "Lucía",
    item: "speakers",
    status: "open",
  };
  private hostForm: HostForm = {
    name: "Rooftop Neighbourhood BBQ",
    when: "Sat 18:30",
    where: "Dachterrasse, Haus 14 — shared on arrival",
    tier: "friends",
    steps: 2,
  };
  private seq = 0;
  /** invalidates scripted timers from cancelled/reset ceremonies */
  private gen = 0;
  private myNonce = crypto.randomUUID();
  private lastError: { action: string; message: string } | null = null;
  private completions: Completion[] = [];

  constructor() {
    this.snapshot = this.compute();
  }

  /* ---------- Connector plumbing ---------- */
  getState = (): AppState => this.snapshot;
  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  private emit() {
    this.snapshot = this.compute();
    this.listeners.forEach((l) => l());
  }
  private dispatchCeremony(e: CeremonyEvent) {
    this.ceremony = ceremonyReducer(this.ceremony, e);
  }

  /* ---------- derivations ---------- */
  private viewer(): string | null {
    return this.onboarded ? ME : null;
  }
  private mutualEdgeWith(id: string): Edge | undefined {
    return this.edges.find(
      (e) => ((e.a === ME && e.b === id) || (e.b === ME && e.a === id)) && e.state !== "none"
    );
  }
  private met(): boolean {
    return this.mutualEdgeWith("maria")?.state === "mutual";
  }

  private people(): PersonView[] {
    const out: PersonView[] = [];
    const ring1 = new Map<string, Edge>();
    for (const e of this.edges) {
      const other = e.a === ME ? e.b : e.b === ME ? e.a : null;
      if (other) ring1.set(other, e);
    }
    for (const [id, e] of ring1) {
      const p = PEOPLE[id];
      out.push({
        id,
        name: p.name,
        ring: 1,
        level: e.state === "mutual" ? effectiveLevel(e) : undefined,
        state: e.state,
        seesYou: true,
        offer: p.offer,
        metContext: p.metContext,
      });
    }
    // ring 2: through mutual ring-1 people. Two DISTINCT rules (docs/20 §Consent):
    //  presence — the far person's own dial must be on, otherwise they are ABSENT
    //  (no node, no count, no residue — v7 rule, retired WEB-3);
    //  sight — they see me only if my dial is on AND the mutual granted them a
    //  view of their ring; when they can't, they render labeled "sees you: no" {WEB-4}.
    for (const [midId, midEdge] of ring1) {
      if (midEdge.state !== "mutual") continue;
      for (const e of this.edges) {
        if (e.state !== "mutual") continue;
        const pairs: Array<[string, string, Grant]> = [
          // [mid, other, grant mid→other]
          [e.a, e.b, e.grantAtoB],
          [e.b, e.a, e.grantBtoA],
        ];
        for (const [from, other, midGrantToOther] of pairs) {
          if (from !== midId || other === ME || ring1.has(other)) continue;
          if (out.some((p) => p.id === other)) continue;
          if (PEOPLE[other].dial === false) continue; // absent entirely
          out.push({
            id: other,
            name: PEOPLE[other].name,
            ring: 2,
            state: "none",
            via: PEOPLE[midId].name,
            seesYou: this.dialOn && midGrantToOther.secondRingVisible,
          });
        }
      }
    }
    // anonymous offerer node {RES-7}
    const projector = this.offers.find((o) => o.id === "projector")!;
    if (this.onboarded && offerVisible({ edges: this.edges }, ME, projector)) {
      out.push({
        id: "anon-projector",
        name: "Someone",
        ring: 2,
        state: "none",
        via: "Maria",
        seesYou: true,
        offer: "a projector",
        anonymous: true,
      });
    }
    return out;
  }

  private reach() {
    const { tier, steps } = this.hostForm;
    if (tier === "public") return null;
    const table: Record<string, Record<number, string>> = {
      commons: { 1: "about 6", 2: "about 23", 3: "about 87" },
      friends: { 1: "about 4", 2: "about 14", 3: "about 52" },
      close: { 1: "about 2", 2: "about 6", 3: "about 19" },
    };
    const names = this.people()
      .filter((p) => p.ring === 1 && p.state === "mutual" && p.seesYou)
      .filter((p) => {
        if (tier === "close") return p.level === "close";
        if (tier === "friends") return p.level === "friend" || p.level === "close";
        return true;
      })
      .map((p) => p.name);
    return { names, approxMore: table[tier][steps] };
  }

  private myPayload(): HandshakePayload | null {
    if (!this.onboarded) return null;
    return {
      did: MY_DID,
      displayName: this.name,
      encKey: "demo-x25519-enc-key",
      nonce: this.myNonce,
      ts: Date.now(),
      ttlSeconds: 120,
      offeredLevel: this.ceremony.offeredLevel,
      grants: { ...this.grants },
    };
  }

  private pending(): string[] {
    const p: string[] = [];
    if (this.ceremony.step === "weaving") p.push("handshake");
    for (const o of this.offers) if (o.state === "requested") p.push(`borrow:${o.id}`);
    return p;
  }

  private compute(): AppState {
    const graph = { edges: this.edges };
    const viewer = this.viewer();
    return {
      me: this.onboarded ? { name: this.name } : null,
      guest: this.guest,
      ceremony: {
        ...this.ceremony,
        advancedOpen: this.advancedOpen,
        grants: { ...this.grants },
        myPayload: this.myPayload(),
      },
      visibleEvents: this.events.filter((ev) => eventVisible(graph, viewer, ev)),
      visibleOffers: this.guest ? [] : this.offers.filter((o) => offerVisible(graph, viewer, o)),
      people: this.onboarded ? this.people() : [],
      activity: [...this.activity],
      threads: [...this.threads],
      intro: this.intro,
      hostForm: { ...this.hostForm },
      reach: this.reach(),
      dialOn: this.dialOn,
      unlocked: this.met(),
      status: { pending: this.pending(), outbox: 0, lastError: this.lastError },
    };
  }

  /* ---------- helpers ---------- */
  private pushActivity(item: Omit<ActivityItem, "id" | "done">) {
    this.activity.unshift({ ...item, id: `a${++this.seq}`, done: false });
  }
  private resolveActivity(id: string, resolution: string) {
    const it = this.activity.find((a) => a.id === id);
    if (it) {
      it.done = true;
      it.resolution = resolution;
      it.actions = [];
    }
  }
  private offer(id: string): Offer {
    const o = this.offers.find((x) => x.id === id);
    if (!o) throw new Error(`unknown offer ${id}`);
    return o;
  }

  /* ---------- actions ---------- */
  actions: ConnectorActions = {
    completeOnboarding: (name) => {
      this.name = name.trim() || "You";
      this.onboarded = true;
      this.guest = false;
      // seed the second-degree ask {RES-6}
      this.pushActivity({
        kind: "extension_approval",
        who: "Rafa",
        icon: "📦",
        text: "wants his web to know about your moving boxes. Share the offer one ring further, through him?",
        subtext: "You still approve every borrower.",
        anchor: "RES-6",
        actions: [
          { id: "share_ext", label: "Share it", kind: "primary" },
          { id: "keep_close", label: "Keep it close", kind: "quiet" },
        ],
      });
      this.emit();
    },
    enterGuest: () => {
      this.guest = true;
      this.onboarded = false;
      this.emit();
    },
    leaveGuest: () => {
      this.guest = false;
      this.emit();
    },

    setOfferedLevel: (level) => {
      this.dispatchCeremony({ type: "SET_LEVEL", level });
      this.emit();
    },
    setChannel: (channel) => {
      this.dispatchCeremony({ type: "SET_CHANNEL", channel });
      this.emit();
    },
    toggleAdvanced: () => {
      this.advancedOpen = !this.advancedOpen;
      this.emit();
    },
    toggleGrant: (key) => {
      if (key === "contextLimit") {
        this.grants.contextLimit = this.grants.contextLimit ? undefined : "ecstatic-dance";
      } else {
        this.grants[key] = !this.grants[key];
      }
      this.emit();
    },
    beginScan: () => {
      const g = ++this.gen;
      this.dispatchCeremony({ type: "SCAN" });
      this.emit();
      // scripted counterpart: Maria's code is found after a beat (a real
      // implementation instead receives ingestScanned() from the camera)
      setTimeout(() => {
        if (g !== this.gen || this.ceremony.step !== "scanning") return;
        this.dispatchCeremony({
          type: "PEER_FOUND",
          peer: { did: "did:key:demo-maria", displayName: "Maria" },
        });
        this.emit();
      }, 1700);
    },
    cancelScan: () => {
      this.gen++;
      this.dispatchCeremony({ type: "CANCEL" });
      this.emit();
    },
    ingestScanned: (raw) => {
      try {
        const p = JSON.parse(raw) as HandshakePayload;
        if (!p.did || !p.displayName || !p.nonce) throw new Error("not a handshake payload");
        if (Date.now() > p.ts + p.ttlSeconds * 1000) throw new Error("code expired — ask them to show it again");
        this.gen++;
        this.dispatchCeremony({ type: "PEER_FOUND", peer: { did: p.did, displayName: p.displayName } });
        this.lastError = null;
      } catch (err) {
        this.lastError = { action: "ingestScanned", message: (err as Error).message };
      }
      this.emit();
    },
    pickLevel: (level) => {
      this.dispatchCeremony({ type: "PICK_LEVEL", level });
      this.emit();
    },
    confirmPeer: () => {
      const level = this.ceremony.confirmedLevel;
      const peer = this.ceremony.peer;
      if (!level || !peer) return;
      const g = ++this.gen;
      this.dispatchCeremony({ type: "CONFIRM" });
      this.emit();
      // scripted counterpart: the peer confirms you back → mutual {CER-5}
      setTimeout(() => {
        if (g !== this.gen || this.ceremony.step !== "weaving") return;
        const personId = DID_TO_ID[peer.did] ?? peer.did;
        this.edges.push(
          edge({
            a: ME,
            b: personId,
            levelAtoB: level,
            levelBtoA: level,
            context: { eventName: "Nachbarschaftsfest Yppenplatz", date: new Date().toISOString().slice(0, 10) },
          })
        );
        if (!this.threads.some((t) => t.personId === personId)) {
          this.threads.unshift({
            personId,
            name: peer.displayName,
            msgs: [{ who: "them", text: "So good to meet you today ✨" }],
          });
        }
        this.dispatchCeremony({ type: "MUTUAL_CONFIRMED" });
        this.emit();
      }, 2100);
    },
    resetCeremony: () => {
      this.gen++;
      this.dispatchCeremony({ type: "RESET" });
      this.myNonce = crypto.randomUUID();
      this.emit();
    },

    requestBorrow: (offerId) => {
      const o = this.offer(offerId);
      const t = tryLoanTransition(o.state, "REQUEST");
      if (!t.ok) {
        this.lastError = { action: "requestBorrow", message: t.error };
        this.emit();
        return;
      }
      o.state = t.state;
      this.emit();
      // scripted owner accepts {RES-4}
      setTimeout(() => {
        if (o.state !== "requested") return;
        o.state = "lent";
        const owner = o.ownerId ? PEOPLE[o.ownerId].name : "Someone";
        this.pushActivity({
          kind: "loan_update",
          who: owner,
          icon: "🔊",
          text: `${owner} lent you the ${o.item.toLowerCase()}. Arrange pickup — and bring them back whole.`,
          anchor: "RES-4",
          actions: [{ id: `return:${o.id}`, label: "Mark returned", kind: "ceremonial" }],
        });
        this.emit();
      }, 1600);
    },

    recordCompletion: (loanId, feltComplete, note) => {
      this.completions.push({ loanId, party: ME, feltComplete, note, ts: Date.now() });
      const o = this.offers.find((x) => x.id === loanId);
      if (o && o.state === "returned") {
        const t = tryLoanTransition(o.state, "BOTH_CHECKED_IN");
        if (t.ok) o.state = "available"; // demo: item is offerable again after completion
      }
      this.emit();
    },

    activityAction: (itemId, actionId) => {
      const item = this.activity.find((a) => a.id === itemId);
      if (!item || item.done) return;
      if (actionId === "share_ext") {
        this.offer("boxes").extendedVia = ["rafa"];
        this.resolveActivity(itemId, "Shared ✓ — your moving boxes now reach Rafa's web through him. Withdraw anytime.");
      } else if (actionId === "keep_close") {
        this.resolveActivity(itemId, "Kept close. Rafa sees a gentle no.");
      } else if (actionId.startsWith("return:")) {
        const o = this.offer(actionId.slice("return:".length));
        const t = tryLoanTransition(o.state, "RETURN");
        if (!t.ok) return;
        o.state = t.state;
        this.resolveActivity(itemId, "Returned ✓");
        const owner = o.ownerId ? PEOPLE[o.ownerId].name : "them";
        this.pushActivity({
          kind: "completion_checkin",
          who: "Completion",
          icon: "🌀",
          text: `The ${o.item.toLowerCase()} came back to ${owner}. Do you feel complete?`,
          anchor: "RES-5",
          actions: [
            { id: `complete:${o.id}`, label: "Complete", kind: "primary" },
            { id: `notyet:${o.id}`, label: "Not yet — say more", kind: "quiet" },
          ],
        });
      } else if (actionId.startsWith("complete:")) {
        const id = actionId.slice("complete:".length);
        this.actions.recordCompletion(id, true);
        const o = this.offer(id);
        const owner = o.ownerId ? PEOPLE[o.ownerId].name : "they";
        this.resolveActivity(itemId, `You felt complete ✓ · ${owner} felt complete ✓ — held between the two of you.`);
      } else if (actionId.startsWith("notyet:")) {
        this.actions.recordCompletion(actionId.slice("notyet:".length), false);
        this.resolveActivity(
          itemId,
          "Noted. What's unresolved stays within your Close friends only — never public, never a number."
        );
      }
      this.emit();
    },

    sendMessage: (personId, text) => {
      const msg = text.trim();
      if (!msg) return;
      const e = this.mutualEdgeWith(personId);
      if (!e || e.state !== "mutual") {
        // {ADR-14} DMs are ring-1 only; rejection is state, not an exception
        this.lastError = { action: "sendMessage", message: "Direct messages open after an introduction — consent first." };
        this.emit();
        return;
      }
      let thread = this.threads.find((t) => t.personId === personId);
      if (!thread) {
        thread = { personId, name: PEOPLE[personId]?.name ?? personId, msgs: [] };
        this.threads.unshift(thread);
      }
      thread.msgs.push({ who: "me", text: msg });
      this.emit();
    },

    changeLevel: (personId, level) => {
      const e = this.mutualEdgeWith(personId);
      if (!e || e.state !== "mutual") return;
      // demo: both directions move together; real impl re-attests per ADR-2
      e.levelAtoB = level;
      e.levelBtoA = level;
      this.emit();
    },

    editGrant: (personId, key, value) => {
      const e = this.mutualEdgeWith(personId);
      if (!e) return;
      const mine = e.a === ME ? e.grantAtoB : e.grantBtoA;
      if (key === "contextLimit") {
        mine.contextLimit = value === "ecstatic-dance" ? "ecstatic-dance" : undefined;
      } else {
        mine[key] = Boolean(value);
      }
      this.emit();
    },

    introduce: (id) => {
      if (this.intro?.id === id) {
        this.intro = { ...this.intro, status: "done" };
        this.emit();
      }
    },
    dismissIntro: (id) => {
      if (this.intro?.id === id) {
        this.intro = { ...this.intro, status: "dismissed" };
        this.emit();
      }
    },

    setHostForm: (patch) => {
      this.hostForm = { ...this.hostForm, ...patch };
      this.emit();
    },
    publishGathering: () => {
      const f = this.hostForm;
      this.events.unshift({
        id: `mine${++this.seq}`,
        name: f.name || "Rooftop Neighbourhood BBQ",
        meta: `${f.when} · ${f.where} · you host this`,
        tier: f.tier,
        steps: f.steps,
        hostIds: [ME],
        kind: "other",
        mine: true,
      });
      this.emit();
    },

    setDial: (on) => {
      this.dialOn = on;
      this.emit();
    },
  };
}

export const levelLabel = (l: Level) => LEVEL_LABEL[l];
export const tierLabel = (t: keyof typeof TIER_LABEL) => TIER_LABEL[t];
