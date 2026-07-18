/**
 * The Connector seam — the ONLY interface the UI talks to. The scaffold ships a
 * MockConnector (apps/web/src/connector/mock); the backend team implements the
 * same interface over the real stack (wot-core / relay / hybrid ADR-4) and the
 * UI does not change. Follows the connector pattern of real-life-stack.
 *
 * SEAM COVERAGE (honest map for implementers):
 * - Fully expressed: visibility-filtered events/offers/people · ceremony incl.
 *   outbound payload (ceremony.myPayload) and inbound scan (ingestScanned) ·
 *   loan loop · completions (recordCompletion) · second-degree extensions ·
 *   introductions · DM send (ring-1 only, ADR-14) · level change · per-person
 *   grant edit · async status/pending/error channel (AppState.status).
 * - Contract-only, no UI yet: changeLevel + editGrant have actions but no
 *   screens; host edit/withdraw and extension-withdraw are specified in docs/20
 *   but have no actions yet.
 * - Known follow-up: ActivityItem still carries rendered prose (text/subtext/
 *   resolution) — should become structured params keyed by `kind`, with copy
 *   templated in the UI. Tracked in docs/10 open questions.
 */
import { CeremonyState } from "./machines.js";
import {
  ActivityItem,
  EventRecord,
  Grant,
  HandshakePayload,
  IntroSuggestion,
  Level,
  Offer,
  PersonView,
  Thread,
  Tier,
} from "./types.js";

export interface HostForm {
  name: string;
  when: string;
  where: string;
  tier: Tier;
  steps: number;
}

export interface AppState {
  /** null until onboarded; guests browse with no identity {DIS-5} */
  me: { name: string } | null;
  guest: boolean;

  ceremony: CeremonyState & {
    advancedOpen: boolean;
    grants: Grant;
    /** MY outbound handshake payload {CER-3} — produced by the connector (the
     *  backend owns DID/keys/nonce); the UI only renders it as QR/NFC. */
    myPayload: HandshakePayload | null;
  };

  /** already filtered by the visibility predicate — the UI never re-checks {DIS-3} */
  visibleEvents: EventRecord[];
  visibleOffers: Offer[];

  people: PersonView[];
  activity: ActivityItem[];
  threads: Thread[];
  intro: IntroSuggestion | null;

  hostForm: HostForm;
  /** approximate reach for the current hostForm: consenting names + rough remainder {HST-4} */
  reach: { names: string[]; approxMore: string } | null;

  dialOn: boolean;
  /** DEMO-SCOPED: true once a handshake at friend+ has opened new gated items —
   *  the scripted arc's "see what opened" cue. Real backends may derive it as
   *  "gated items became visible since last look" or drop it. */
  unlocked: boolean;

  /** Async affordance {docs/20 §Handshake offline rule; critic review}: actions
   *  stay fire-and-forget; progress and failure are STATE, never exceptions. */
  status: {
    /** identifiers of in-flight operations, e.g. "handshake", "borrow:speakers" */
    pending: string[];
    /** queued-for-offline envelopes awaiting connectivity */
    outbox: number;
    lastError: { action: string; message: string } | null;
  };
}

export interface ConnectorActions {
  /* onboarding {ONB-*} */
  completeOnboarding(name: string): void;
  enterGuest(): void;
  /** from the guest join bar back to the welcome screen */
  leaveGuest(): void;

  /* ceremony {CER-*} */
  setOfferedLevel(level: Level): void;
  setChannel(channel: "qr" | "nfc"): void;
  toggleAdvanced(): void;
  toggleGrant(key: keyof Grant): void;
  beginScan(): void;
  cancelScan(): void;
  /** Hand the connector a decoded scan (QR/NFC read). The connector parses and
   *  validates the HandshakePayload (nonce/TTL) and moves the ceremony to
   *  confirm with the REAL peer identity — the UI never fabricates a peer. */
  ingestScanned(raw: string): void;
  pickLevel(level: Level): void;
  confirmPeer(): void;
  resetCeremony(): void;

  /* offers + loans {RES-*} */
  requestBorrow(offerId: string): void;
  /** {RES-5} both parties record independently; note only with feltComplete=false */
  recordCompletion(loanId: string, feltComplete: boolean, note?: string): void;

  /* chat feed {ACT-*} */
  activityAction(itemId: string, actionId: string): void;
  /** {ADR-14} ring-1 only; a non-connection target must surface status.lastError */
  sendMessage(personId: string, text: string): void;

  /* relationships {PPL-2, ADR-2} */
  changeLevel(personId: string, level: Level): void;
  editGrant(personId: string, key: keyof Grant, value: boolean | "ecstatic-dance" | undefined): void;

  /* introductions {INT-*} */
  introduce(suggestionId: string): void;
  dismissIntro(suggestionId: string): void;

  /* hosting {HST-*} */
  setHostForm(patch: Partial<HostForm>): void;
  publishGathering(): void;

  /* consent {YOU-2} */
  setDial(on: boolean): void;
}

export interface Connector {
  getState(): AppState;
  subscribe(cb: () => void): () => void;
  actions: ConnectorActions;
}
