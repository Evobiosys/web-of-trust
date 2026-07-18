// The ONE place asker-facing API views get built (I2). Nothing else in this
// package should hand-construct an `asks[]` or `/api/audit` entry — every
// call site funnels through here so there is exactly one chokepoint to audit
// for peer-id/per-peer-state leaks.
import type { Store } from "../store/store.js";
import type { AskRecord, AuditRecord, ListingRecord, LoanRecord, ReceivedListingRecord } from "../store/types.js";
import type {
  AskApiState,
  AskApiView,
  AuditApiEntry,
  ConsentCardApiView,
  DmMessageApiView,
  ListingApiView,
  LoanApiView,
  ReceivedListingApiView,
  RoomApiView,
  StateSnapshot,
  StewardLogApiView,
  ThreadApiView,
} from "./types.js";

/**
 * Internal asker state machine (state-machine.ts AskerRequestState) -> API
 * aggregate state. THE load-bearing line is `pending -> "waiting"`: internal
 * "pending" means "at least one owner sent STATUS(PENDING)" but that is NOT
 * exposed as anything more specific than "waiting" — only a later CONSENT
 * envelope (a structurally distinct message) advances the asker's view to
 * "someone_can_help". A PENDING on the wire never lets the asker distinguish
 * "someone might help" from "still gathering replies" (I2).
 *
 * TTL-while-still-"pending" is a documented interpretation call: the frozen
 * state-machine.ts has NO event that moves "pending" to a terminal state
 * except CONSENT (-> consented) or WITHDRAW (-> withdrawn) — there is no
 * "pending -> pass" transition, so an owner who never decides (or declines
 * after their PENDING already went out, I3 silence) would otherwise leave
 * the asker waiting forever. Rather than force an event the protocol package
 * doesn't define, this is resolved at the VIEW layer only: the stored
 * internal_state honestly stays "pending" (nothing false is persisted), but
 * once `now` is past `created_at + ttl_ms` with no consent ever received,
 * the API-exposed state degrades to "no_one_this_time" — indistinguishable,
 * from the asker's perspective, from a genuine no-match. This is squarely
 * I3's spirit (a graceful, silent timeout) and is documented in docs/DAEMON.md.
 */
function askerStateToApi(ask: AskRecord, now: Date): AskApiState {
  switch (ask.internal_state) {
    case "open":
      return "open";
    case "pending": {
      const deadline = new Date(ask.created_at).getTime() + ask.ttl_ms;
      return now.getTime() >= deadline ? "no_one_this_time" : "waiting";
    }
    case "pass":
      return "no_one_this_time";
    case "consented":
      return "someone_can_help";
    case "room":
      return "room_open";
    case "closed":
      // Not reachable via any M2 flow (no "close a finished room" action is
      // implemented) but mapped defensively rather than left to throw.
      return "room_open";
    case "withdrawn":
      return "withdrawn";
  }
}

export function buildAskApiView(ask: AskRecord, now: Date): AskApiView {
  return {
    request_id: ask.request_id,
    text: ask.text,
    created_at: ask.created_at,
    state: askerStateToApi(ask, now),
    queried_count: ask.queried_count,
    room_id: ask.room_id,
  };
}

export function buildStateSnapshot(persona: { name: string; peer_id: string; accent: string }, store: Store, now: Date): StateSnapshot {
  const asks = store.getAsks().map((ask) => buildAskApiView(ask, now));

  const consent_cards: ConsentCardApiView[] = store.getIncomings().map((incoming) => {
    const item = incoming.matched_item_id ? store.getItem(incoming.matched_item_id) : undefined;
    if (!item) {
      throw new Error(`consent card ${incoming.card_id} references missing item ${incoming.matched_item_id}`);
    }
    return {
      card_id: incoming.card_id,
      request_id: incoming.request_id,
      requester: { peer_id: incoming.requester_peer, display: incoming.requester_display },
      text: incoming.text,
      matched_item: item,
      kind: incoming.kind,
      state: incoming.state,
      created_at: incoming.received_at,
    };
  });

  const rooms: RoomApiView[] = store.getRooms().map((room) => ({
    room_id: room.room_id,
    peers: room.peers,
    messages: store.getRoomMessages(room.room_id).map((m) => ({ from: m.from, text: m.text, ts: m.ts })),
    context: room.context,
  }));

  const steward_log: StewardLogApiView[] = store.getStewardLog();

  return {
    persona,
    items: store.getItems(),
    trust_edges: store.getTrustEdges(),
    asks,
    consent_cards,
    rooms,
    steward_log,
    listings_mine: store.getListings().map(buildListingApiView),
    listings_received: store.getReceivedListings().map(buildReceivedListingApiView),
    loans: store.getLoans().map(buildLoanApiView),
    threads: store.getDmPeers().map((peer) => buildThreadApiView(store, peer)),
  };
}

// ------------------------------------------------------------- D14 views --

function buildListingApiView(listing: ListingRecord): ListingApiView {
  return {
    listing_id: listing.listing_id,
    kind: listing.kind,
    title: listing.title,
    description: listing.description,
    when: listing.when,
    where_public: listing.where_public,
    where_gated: listing.where_gated,
    tier: listing.tier,
    steps: listing.steps,
    state: listing.state,
    owner_display: listing.owner_display,
    created_at: listing.created_at,
  };
}

function buildReceivedListingApiView(listing: ReceivedListingRecord): ReceivedListingApiView {
  return {
    listing_id: listing.listing_id,
    kind: listing.kind,
    title: listing.title,
    description: listing.description,
    when: listing.when,
    where_public: listing.where_public,
    where_gated: listing.where_gated,
    tier: listing.tier,
    steps: listing.steps,
    state: listing.state,
    owner_display: listing.owner_display,
    created_at: listing.received_at,
    via: listing.via,
    from_peer: listing.from_peer,
    received_at: listing.received_at,
  };
}

function buildLoanApiView(loan: LoanRecord): LoanApiView {
  return {
    loan_id: loan.loan_id,
    listing_id: loan.listing_id,
    role: loan.role,
    counterparty: { peer_id: loan.counterparty_peer, display: loan.counterparty_display },
    state: loan.state,
    note: loan.note,
    completion_detail: loan.completion_detail,
    created_at: loan.created_at,
    updated_at: loan.updated_at,
  };
}

function buildThreadApiView(store: Store, peer: string): ThreadApiView {
  const messages: DmMessageApiView[] = store.getDmMessages(peer).map((m) => ({ direction: m.direction, text: m.text, ts: m.ts }));
  return { peer_id: peer, display: store.getTrustEdge(peer)?.display ?? peer, messages };
}

/**
 * /api/audit (I6, human-readable). I4 gives the owner unrestricted visibility
 * into requests THEY received (actor: "owner"); I2 requires the asker's own
 * audit trail (actor: "asker", i.e. requests THIS persona sent) to redact
 * peer identity and the PENDING-vs-PASS distinction.
 *
 * That guarantee is enforced entirely at WRITE time, not here: every
 * actor:"asker" entry goes through audit/audit.ts's `logAsker`, which throws
 * if `detail` would contain a peer id or the word "PENDING" — so by the time
 * an entry reaches `store.getAudit()`, it is already safe. This function
 * does no read-time filtering or redaction of its own (it does not even look
 * at `redact_for_asker` or `actor`); it is a plain, unconditional map from
 * `AuditRecord` to the wire shape. The dedicated test that scans the
 * serialized response for configured peer ids and the literal "PENDING" is
 * therefore verifying `logAsker`'s write-time guard, not any behavior here.
 */
export function buildAuditApiView(entries: AuditRecord[]): AuditApiEntry[] {
  return entries.map((e) => ({ ts: e.ts, decision: e.action, detail: e.detail }));
}
