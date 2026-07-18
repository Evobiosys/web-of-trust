// D14 — listings (offers/gatherings) and their borrow (loan) lifecycle.
// Free functions over a small deps bag (same composition style as
// steward.ts's `classifyAndRespond`/`StewardDeps`), called by thin Daemon
// methods in daemon.ts. Split out here because daemon.ts was already long
// before this feature; see task-2-report.md for the extraction note.
//
// Design notes (interpretation calls, documented rather than silently
// assumed — see DECISIONS.md D14):
//
// - Tier -> trust-level gate (`levelSatisfiesTier`): "private" reaches no
//   one (the listing stays local-only, mirroring evaluatePolicy's audience
//   "private"); "close" requires level "close" exactly; "trusted" requires
//   level "close" OR "friend" (the brief's "close"+"friend"); "wot_commons"
//   and "public" reach every non-expired edge regardless of level ("public"
//   additionally surfaces in Task 5's guest/unauthenticated API — this
//   module only guarantees the same edge set as wot_commons at the daemon
//   layer, per the exact wording "wot_commons/public→all edges").
//
// - Forwarding ("declared reach"): a receiver forwards once per
//   (listing_id, state) pair — tracked via `ReceivedListingRecord.forwarded`,
//   reset whenever the incoming envelope's `state` differs from what's
//   currently stored. This is what makes a withdrawal (state flips
//   active->withdrawn) re-propagate through exactly the same tree the
//   original publish reached, and is also what stops a duplicate delivery
//   of the *same* state from re-forwarding — required for correctness in a
//   trust graph with cycles, not just literal spec compliance ("forward
//   once").
//
// - "excluding origin + already-via peers": the immediate sender (`from`)
//   plus everyone already in `via` are excluded from a forward's target
//   set. This alone does not exclude the *original owner* once the chain is
//   two-plus hops deep (forwarders only append themselves to `via`, never
//   the owner, since a publish starts with `via: []`) — closed instead by
//   `receiveListing`'s first check: if `listing_id` is already in this
//   persona's own `listings` table (i.e. *I* am the owner), the incoming
//   envelope is ignored outright, regardless of who it came from or what
//   `via`/`from` say. This is origin-safe under either reading of "origin"
//   and is cheap: an owner's own listing_id is always locally known.
//
// - "not_yet detail stays local" (mockup RES-5): `checkInLoanCompletion`
//   never places its `detail` argument into the outbound LOAN envelope's
//   `note` — for *either* outcome, not just "not_yet". A completion
//   check-in's explanatory text is always this persona's own private
//   annotation; only the coarse `complete`/`not_yet` marker crosses the
//   wire. "Owner confirm" from the brief is folded into this same function
//   (either loan role may call it once `state === "returned"`) rather than
//   inventing a wire state the LOAN enum doesn't have.
//
// - Borrow is alpha/direct-only: `requestBorrow` throws if the received
//   listing's `via` is non-empty (it arrived via a forward, so this persona
//   doesn't actually know the owner's peer id — only their display name).
//   Via-chain borrow is deferred to the existing relay/ask flow — see
//   FUTURE.md's "Second-degree borrow via via-chain" entry.
import { randomUUID } from "node:crypto";
import type { ListingBody, LoanBody, TrustEdge, TrustLevel, TransportAdapter } from "@resource-web/protocol";
import type { Clock } from "../clock.js";
import type { Store } from "../store/store.js";
import type { ListingRecord, ListingTier, LoanRecord, LoanState, ReceivedListingRecord } from "../store/types.js";
import { logOwner } from "../audit/audit.js";
import { dmEnvelope, listingEnvelope, loanEnvelope } from "./envelopes.js";

export interface ListingsDeps {
  store: Store;
  clock: Clock;
  transport: TransportAdapter;
  peerId: string;
  personaName: string;
}

export interface PublishListingInput {
  kind: "offer" | "gathering";
  title: string;
  description: string;
  when?: string;
  where_public?: string;
  where_gated?: string;
  tier: ListingTier;
  /** Declared forwarding reach; defaults to 2 (I9-style conservative-but-useful default). */
  steps?: 1 | 2 | 3;
}

// ---------------------------------------------------------- tier <-> level --

const LEVEL_ORDINAL: Record<TrustLevel, number> = { contact: 0, friend: 1, close: 2 };

export function levelSatisfiesTier(level: TrustLevel, tier: ListingTier): boolean {
  switch (tier) {
    case "private":
      return false;
    case "close":
      return level === "close";
    case "trusted":
      return LEVEL_ORDINAL[level] >= LEVEL_ORDINAL.friend;
    case "wot_commons":
    case "public":
      return true;
  }
}

function eligibleEdgesForTier(edges: TrustEdge[], tier: ListingTier, now: Date): TrustEdge[] {
  return edges.filter((e) => new Date(e.expires_at).getTime() > now.getTime() && levelSatisfiesTier(e.level, tier));
}

function nextSteps(steps: 1 | 2 | 3): 1 | 2 {
  return (steps - 1) as 1 | 2;
}

// ------------------------------------------------------------- publishing --

async function broadcastListing(deps: ListingsDeps, record: ListingRecord): Promise<void> {
  const edges = eligibleEdgesForTier(deps.store.getTrustEdges(), record.tier, deps.clock.now());
  const body: ListingBody = {
    listing_id: record.listing_id,
    kind: record.kind,
    title: record.title,
    description: record.description,
    when: record.when,
    where_public: record.where_public,
    where_gated: record.where_gated,
    tier: record.tier,
    steps: record.steps,
    via: [],
    state: record.state,
    owner_display: record.owner_display,
  };
  for (const edge of edges) {
    await deps.transport.send(edge.peer, listingEnvelope(deps.clock.now(), body));
  }
}

export async function publishListing(deps: ListingsDeps, input: PublishListingInput): Promise<ListingRecord> {
  const record: ListingRecord = {
    listing_id: randomUUID(),
    kind: input.kind,
    title: input.title,
    description: input.description,
    when: input.when,
    where_public: input.where_public,
    where_gated: input.where_gated,
    tier: input.tier,
    steps: input.steps ?? 2,
    owner_display: deps.personaName,
    state: "active",
    created_at: deps.clock.now().toISOString(),
  };
  deps.store.putListing(record);
  await broadcastListing(deps, record);
  logOwner(deps.store, deps.clock, record.listing_id, "listing_published", `Published "${record.title}" (tier=${record.tier}, steps=${record.steps}).`);
  return record;
}

export async function withdrawListing(deps: ListingsDeps, listingId: string): Promise<void> {
  const record = deps.store.getListing(listingId);
  if (!record) throw new Error(`withdrawListing: unknown listing ${listingId}`);
  if (record.state === "withdrawn") return;
  const updated: ListingRecord = { ...record, state: "withdrawn" };
  deps.store.putListing(updated);
  await broadcastListing(deps, updated);
  logOwner(deps.store, deps.clock, listingId, "listing_withdrawn", `Withdrew "${record.title}".`);
}

// -------------------------------------------------------------- receiving --

export async function receiveListing(deps: ListingsDeps, from: string, body: ListingBody): Promise<void> {
  // Origin-safe under either reading of "origin": if I am the owner (this
  // listing_id is in MY OWN `listings` table), ignore it outright — closes
  // the gap a naive {from, ...via} exclusion leaves open once a cyclic trust
  // graph routes a forward back around at steps >= 3 (see module doc comment).
  if (deps.store.getListing(body.listing_id)) return;

  const existing = deps.store.getReceivedListing(body.listing_id);
  const stateChanged = !existing || existing.state !== body.state;
  const record: ReceivedListingRecord = {
    listing_id: body.listing_id,
    kind: body.kind,
    title: body.title,
    description: body.description,
    when: body.when,
    where_public: body.where_public,
    where_gated: body.where_gated,
    tier: body.tier,
    steps: body.steps,
    via: body.via,
    owner_display: body.owner_display,
    state: body.state,
    from_peer: from,
    received_at: deps.clock.now().toISOString(),
    forwarded: stateChanged ? false : (existing?.forwarded ?? false),
  };
  deps.store.putReceivedListing(record);

  if (!stateChanged || record.forwarded) return; // dedupe: already processed this (listing_id, state)

  const senderEdge = deps.store.getTrustEdge(from);
  const canForward =
    body.tier !== "close" && // close-tier: inner room, never forwarded, regardless of steps
    body.steps > 1 &&
    senderEdge !== undefined &&
    levelSatisfiesTier(senderEdge.level, body.tier);

  if (canForward) {
    const excluded = new Set([from, ...body.via]);
    const targets = eligibleEdgesForTier(deps.store.getTrustEdges(), body.tier, deps.clock.now()).filter((e) => !excluded.has(e.peer));
    const forwardBody: ListingBody = { ...body, steps: nextSteps(body.steps), via: [...body.via, deps.peerId] };
    for (const target of targets) {
      await deps.transport.send(target.peer, listingEnvelope(deps.clock.now(), forwardBody));
      logOwner(
        deps.store,
        deps.clock,
        body.listing_id,
        "listing_forwarded",
        `Forwarded "${body.title}" (${body.state}) to ${target.peer} within declared reach (I6).`
      );
    }
  }
  deps.store.putReceivedListing({ ...record, forwarded: true });
}

// ------------------------------------------------------------------ loans --

function requireLoan(deps: ListingsDeps, loanId: string): LoanRecord {
  const loan = deps.store.getLoan(loanId);
  if (!loan) throw new Error(`unknown loan ${loanId}`);
  return loan;
}

async function sendLoanUpdate(deps: ListingsDeps, loan: LoanRecord, state: LoanState, note?: string): Promise<void> {
  const body: LoanBody = { listing_id: loan.listing_id, loan_id: loan.loan_id, state, note };
  await deps.transport.send(loan.counterparty_peer, loanEnvelope(deps.clock.now(), body));
}

async function transitionLoan(
  deps: ListingsDeps,
  loanId: string,
  expectedRole: LoanRecord["role"],
  fromStates: readonly LoanState[],
  toState: LoanState,
  note?: string
): Promise<LoanRecord> {
  const loan = requireLoan(deps, loanId);
  if (loan.role !== expectedRole) {
    throw new Error(`transitionLoan: loan ${loanId} is role '${loan.role}', expected '${expectedRole}'`);
  }
  if (!fromStates.includes(loan.state)) {
    throw new Error(`transitionLoan: loan ${loanId} is '${loan.state}', expected one of [${fromStates.join(", ")}]`);
  }
  const updated: LoanRecord = { ...loan, state: toState, note: note ?? loan.note, updated_at: deps.clock.now().toISOString() };
  deps.store.putLoan(updated);
  logOwner(deps.store, deps.clock, loanId, `loan_${toState}`, `Loan for listing ${loan.listing_id} -> ${toState}.`);
  await sendLoanUpdate(deps, updated, toState, note);
  return updated;
}

/** Alpha: direct-connection borrow only — see module doc comment / FUTURE.md. */
export async function requestBorrow(deps: ListingsDeps, listingId: string, note?: string): Promise<LoanRecord> {
  const listing = deps.store.getReceivedListing(listingId);
  if (!listing) throw new Error(`requestBorrow: unknown received listing ${listingId}`);
  if (listing.via.length > 0) {
    throw new Error(
      `requestBorrow: listing ${listingId} arrived via a forward (via=[${listing.via.join(", ")}]) — alpha only supports ` +
        `direct-connection borrow; via-chain borrow goes through the existing relay/ask flow (FUTURE.md).`
    );
  }
  if (listing.state !== "active") {
    throw new Error(`requestBorrow: listing ${listingId} is ${listing.state}, not active`);
  }
  const ownerPeer = listing.from_peer;
  const nowIso = deps.clock.now().toISOString();
  const record: LoanRecord = {
    loan_id: randomUUID(),
    listing_id: listingId,
    role: "borrower",
    counterparty_peer: ownerPeer,
    counterparty_display: listing.owner_display,
    state: "requested",
    note,
    created_at: nowIso,
    updated_at: nowIso,
  };
  deps.store.putLoan(record);
  logOwner(deps.store, deps.clock, record.loan_id, "loan_requested", `Requested to borrow "${listing.title}".`);
  await sendLoanUpdate(deps, record, "requested", note);
  return record;
}

export const approveLoan = (deps: ListingsDeps, loanId: string): Promise<LoanRecord> =>
  transitionLoan(deps, loanId, "owner", ["requested"], "approved");

export const declineLoan = (deps: ListingsDeps, loanId: string): Promise<LoanRecord> =>
  transitionLoan(deps, loanId, "owner", ["requested"], "declined");

export const markLent = (deps: ListingsDeps, loanId: string): Promise<LoanRecord> =>
  transitionLoan(deps, loanId, "owner", ["approved"], "lent");

export const markReturned = (deps: ListingsDeps, loanId: string): Promise<LoanRecord> =>
  transitionLoan(deps, loanId, "borrower", ["lent"], "returned");

/** States `checkInLoanCompletion` may (re)run from — "returned" (the normal
 * first check-in) plus the two completion outcomes themselves: `receiveLoan`
 * keeps a single `state` field per side and doesn't distinguish "I reported
 * this myself" from "the counterparty's report just synced my local view",
 * so if the counterparty's LOAN{complete|not_yet} arrives first, MY own
 * `state` already reads as a completion outcome by the time I go to check in
 * — this is still "my side's own turn", not a re-entry, so it must stay
 * allowed (both sides really do act independently, per the brief). */
const COMPLETION_CHECK_IN_FROM: readonly LoanState[] = ["returned", "complete", "not_yet"];

/**
 * Either party's own completion check-in, once the loan is "returned" (or
 * still is, from their own perspective — see COMPLETION_CHECK_IN_FROM) —
 * folds the brief's "owner confirm" into this same call (owner and borrower
 * both use it; there's no separate wire state for "confirmed"). `detail` is
 * LOCAL ONLY: stored in `completion_detail`, never placed on the wire for
 * either outcome (see module doc comment, mockup RES-5).
 */
export async function checkInLoanCompletion(
  deps: ListingsDeps,
  loanId: string,
  outcome: "complete" | "not_yet",
  detail?: string
): Promise<LoanRecord> {
  const loan = requireLoan(deps, loanId);
  if (!COMPLETION_CHECK_IN_FROM.includes(loan.state)) {
    throw new Error(`checkInLoanCompletion: loan ${loanId} is '${loan.state}', expected 'returned'`);
  }
  const updated: LoanRecord = { ...loan, state: outcome, completion_detail: detail, updated_at: deps.clock.now().toISOString() };
  deps.store.putLoan(updated);
  logOwner(
    deps.store,
    deps.clock,
    loanId,
    `loan_${outcome}`,
    outcome === "complete" ? `Completion check-in: complete.` : `Completion check-in: not yet (detail stays local, mockup RES-5).`
  );
  await sendLoanUpdate(deps, updated, outcome); // note intentionally omitted — see doc comment.
  return updated;
}

export function receiveLoan(deps: ListingsDeps, from: string, body: LoanBody): void {
  const existing = deps.store.getLoan(body.loan_id);
  const nowIso = deps.clock.now().toISOString();
  if (!existing) {
    // First time seeing this loan_id: I must be the owner side, just asked to lend.
    const listing = deps.store.getListing(body.listing_id);
    const record: LoanRecord = {
      loan_id: body.loan_id,
      listing_id: body.listing_id,
      role: "owner",
      counterparty_peer: from,
      counterparty_display: deps.store.getTrustEdge(from)?.display ?? from,
      state: body.state,
      note: body.note,
      created_at: nowIso,
      updated_at: nowIso,
    };
    deps.store.putLoan(record);
    logOwner(deps.store, deps.clock, body.loan_id, "loan_requested", `Borrow requested for "${listing?.title ?? body.listing_id}".`);
    return;
  }
  deps.store.putLoan({ ...existing, state: body.state, note: body.note, updated_at: nowIso });
  logOwner(deps.store, deps.clock, body.loan_id, `loan_${body.state}`, `Loan updated to "${body.state}".`);
}

// -------------------------------------------------------------------- DMs --

/** DMs only between connected peers (any trust level) — throws on send if no edge exists. */
export async function sendDm(deps: ListingsDeps, peer: string, text: string): Promise<void> {
  const edge = deps.store.getTrustEdge(peer);
  if (!edge) throw new Error(`sendDm: not connected to ${peer} — DMs require an existing trust edge`);
  deps.store.addDmMessage({ peer, direction: "outgoing", text, ts: deps.clock.now().toISOString() });
  await deps.transport.send(peer, dmEnvelope(randomUUID(), deps.clock.now(), { text }));
}

/** Connected-only, defense in depth: silently drops a DM from a peer with no trust edge. */
export function receiveDm(deps: ListingsDeps, from: string, text: string): void {
  const edge = deps.store.getTrustEdge(from);
  if (!edge) return;
  deps.store.addDmMessage({ peer: from, direction: "incoming", text, ts: deps.clock.now().toISOString() });
}
