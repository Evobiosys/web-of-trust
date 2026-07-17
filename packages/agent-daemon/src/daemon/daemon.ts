// Daemon — one persona's whole agent: owner-side request lifecycle (I3),
// asker-side fan-out + aggregation (I2), room chat, and the REST/WS surface's
// backing logic. This class is deliberately the single place lifecycle state
// changes happen so the two invariants at the heart of this package have one
// call site each to audit:
//   - I3: `dispatchOwnerStatus` is the ONLY place a STATUS envelope is sent,
//     and it always computes PASS-vs-PENDING from the card's state AT FIRE
//     TIME — never from whatever triggered the schedule.
//   - I2: asker-facing reads never happen here directly; callers go through
//     api/sanitize.ts, and every audit entry about an ask this persona SENT
//     goes through audit/audit.ts's `logAsker`, which refuses to persist a
//     peer id or a PENDING-vs-PASS distinction.
import { randomUUID } from "node:crypto";
import {
  evaluatePolicy,
  statusDispatchAt,
  transitionAskerState,
  transitionOwnerState,
  type Envelope,
  type Item,
  type TransportAdapter,
  type WithdrawnReason,
} from "@resource-web/protocol";
import type { Clock, Scheduler } from "../clock.js";
import { hasRoomMessaging, type RoomMessage } from "../transport/in_memory_transport.js";
import type { Store } from "../store/store.js";
import type { AskPeerRecord, AskRecord, IncomingKind, IncomingRecord } from "../store/types.js";
import { matchRequestToItems, type MatcherConfig } from "../matcher/matcher.js";
import type { ChatClient, EmbedClient } from "../matcher/clients.js";
import { logAsker, logOwner } from "../audit/audit.js";
import { consentEnvelope, introEnvelope, requestEnvelope, statusEnvelope, withdrawnEnvelope } from "./envelopes.js";
import { classifyAndRespond, type StewardDeps } from "../steward/steward.js";
import { buildAuditApiView, buildStateSnapshot } from "../api/sanitize.js";
import type { AuditApiEntry, StateSnapshot } from "../api/types.js";

export interface DaemonConfig {
  personaName: string;
  peerId: string;
  accent: string;
  statusDelayMs: number;
  defaultAskTtlMs: number;
  matcher: MatcherConfig;
}

export interface DaemonDeps {
  config: DaemonConfig;
  store: Store;
  transport: TransportAdapter;
  scheduler: Scheduler;
  clock: Clock;
  embedClient: EmbedClient;
  chatClient: ChatClient;
  /** Called after any state mutation — server.ts uses this to fan out the WS `state_changed` event. */
  onChange?: () => void;
}

export class Daemon {
  constructor(private readonly deps: DaemonDeps) {}

  private get store(): Store {
    return this.deps.store;
  }
  private get transport(): TransportAdapter {
    return this.deps.transport;
  }
  private get scheduler(): Scheduler {
    return this.deps.scheduler;
  }
  private get clock(): Clock {
    return this.deps.clock;
  }
  private get cfg(): DaemonConfig {
    return this.deps.config;
  }
  private get matcherDeps() {
    return { store: this.store, embedClient: this.deps.embedClient, chatClient: this.deps.chatClient, config: this.cfg.matcher };
  }

  async init(): Promise<void> {
    await this.transport.init({ self: this.cfg.peerId, display: this.cfg.personaName });
    // Returning the promise (not `void`-ing it) lets InMemoryTransport await
    // full receiver-side processing before `send()` resolves — see
    // in_memory_transport.ts's RegisteredPeer note. TS's void-return leniency
    // allows this assignment even though TransportAdapter's onEnvelope type
    // says the callback returns void.
    this.transport.onEnvelope((from, env) => this.handleEnvelope(from, env));
    if (hasRoomMessaging(this.transport)) {
      this.transport.onRoomMessage((msg) => this.onRoomMessage(msg));
    }
  }

  // ---------------------------------------------------------------- state --

  getStateSnapshot(): StateSnapshot {
    return buildStateSnapshot({ name: this.cfg.personaName, peer_id: this.cfg.peerId, accent: this.cfg.accent }, this.store, this.clock.now());
  }

  getAudit(): AuditApiEntry[] {
    return buildAuditApiView(this.store.getAudit());
  }

  private notifyChange(): void {
    this.deps.onChange?.();
  }

  /** server.ts wires this to broadcast the WS `state_changed` event. */
  setOnChange(cb: () => void): void {
    this.deps.onChange = cb;
  }

  // ---------------------------------------------------------- asker side --

  async sendAsk(text: string, opts: { ttlMs?: number; lang?: string; area?: string } = {}): Promise<AskRecord> {
    const requestId = randomUUID();
    const createdAt = this.clock.now();
    const ttlMs = opts.ttlMs ?? this.cfg.defaultAskTtlMs;

    let embedding: number[] | undefined;
    try {
      const [vector] = await this.deps.embedClient.embed(this.cfg.matcher.embedModel, [text]);
      embedding = vector;
    } catch {
      embedding = undefined;
    }

    const edges = this.store.getTrustEdges().filter((e) => new Date(e.expires_at).getTime() > createdAt.getTime());
    const peers: AskPeerRecord[] = edges.map((e) => ({ peer: e.peer, state: "queried" }));
    const ask: AskRecord = {
      request_id: requestId,
      text,
      lang: opts.lang,
      area: opts.area,
      created_at: createdAt.toISOString(),
      ttl_ms: ttlMs,
      internal_state: "open",
      queried_count: edges.length,
      peers,
    };
    this.store.putAsk(ask);
    logAsker(
      this.store,
      this.clock,
      requestId,
      "sent_request",
      `Fanned out REQUEST to ${edges.length} trusted peer(s).`,
      edges.map((e) => e.peer)
    );

    for (const edge of edges) {
      await this.transport.send(edge.peer, requestEnvelope(requestId, createdAt, { text, lang: opts.lang, embedding, area: opts.area, ttl: ttlMs }));
    }

    this.checkAskAllIn(requestId);
    this.scheduler.scheduleAt(new Date(createdAt.getTime() + ttlMs).toISOString(), () => this.resolveAskOnTtl(requestId));

    this.notifyChange();
    return this.store.getAsk(requestId)!;
  }

  async withdraw(requestId: string, reason: WithdrawnReason = "cancelled"): Promise<void> {
    const ask = this.store.getAsk(requestId);
    if (!ask) throw new Error(`withdraw: unknown request ${requestId}`);
    ask.internal_state = transitionAskerState(ask.internal_state, { type: "WITHDRAW", reason });
    ask.withdrawn_reason = reason;
    this.store.putAsk(ask);
    logAsker(
      this.store,
      this.clock,
      requestId,
      "withdrawn",
      `Withdrew request (${reason}).`,
      ask.peers.map((p) => p.peer)
    );
    for (const peer of ask.peers) {
      await this.transport.send(peer.peer, withdrawnEnvelope(requestId, this.clock.now(), reason));
    }
    this.notifyChange();
  }

  private checkAskAllIn(requestId: string): void {
    const ask = this.store.getAsk(requestId);
    if (!ask || ask.internal_state !== "open") return;
    const allIn = ask.peers.every((p) => p.state !== "queried");
    if (!allIn) return;
    const anyPending = ask.peers.some((p) => p.state === "pending" || p.state === "consented");
    ask.internal_state = transitionAskerState("open", { type: "STATUS_ALL_IN", anyPending });
    this.store.putAsk(ask);
    logAsker(
      this.store,
      this.clock,
      requestId,
      "status_resolved",
      anyPending ? "Aggregate resolved: waiting for someone to help." : "Aggregate resolved: no one this time.",
      ask.peers.map((p) => p.peer)
    );
  }

  /**
   * Fires at the ask's own TTL. Two cases, BOTH must notify (WS
   * `state_changed`) so a WS-only client refetches and sees the right view:
   *   - internal_state still "open" (nobody replied at all, or not everyone
   *     did): forces the STATUS_ALL_IN resolution here, same as if the last
   *     peer's STATUS had just arrived.
   *   - internal_state already "pending" (someone matched + sent PENDING,
   *     but no CONSENT ever arrived — including the I3 decline-after-
   *     dispatch case, which leaves internal_state at "pending" forever by
   *     design, see api/sanitize.ts): nothing to mutate here — the
   *     degradation to "no_one_this_time" happens at the VIEW layer purely
   *     from `now` vs `created_at + ttl_ms` — but a client watching WS only
   *     (never polling) still needs a nudge to go re-fetch /api/state and
   *     observe that degraded view. Without this, such a client would show
   *     stale "waiting" forever once the state machine itself stops
   *     changing.
   */
  private resolveAskOnTtl(requestId: string): void {
    const ask = this.store.getAsk(requestId);
    if (!ask) return;
    if (ask.internal_state !== "open") {
      // Not stuck in "open" — either already resolved to "pending"/"pass"/etc
      // in the normal way, or genuinely withdrawn/consented/roomed. Only the
      // still-"pending" case has a view-layer-only change to announce at
      // this exact moment; the others already notified when they happened.
      if (ask.internal_state === "pending") {
        this.notifyChange();
      }
      return;
    }
    const anyPending = ask.peers.some((p) => p.state === "pending" || p.state === "consented");
    ask.internal_state = transitionAskerState("open", { type: "STATUS_ALL_IN", anyPending });
    this.store.putAsk(ask);
    logAsker(
      this.store,
      this.clock,
      requestId,
      "status_resolved",
      `TTL reached: aggregate resolved to ${anyPending ? "waiting for someone to help" : "no one this time"}.`,
      ask.peers.map((p) => p.peer)
    );
    this.notifyChange();
  }

  private askerHandleStatus(from: string, requestId: string, state: "PASS" | "PENDING"): void {
    const ask = this.store.getAsk(requestId);
    if (!ask) return;
    const peer = ask.peers.find((p) => p.peer === from);
    if (!peer) return;
    peer.state = state === "PASS" ? "pass" : "pending";
    this.store.putAsk(ask);
    this.checkAskAllIn(requestId);
  }

  private askerHandleConsent(from: string, requestId: string, conditions?: string): void {
    void conditions;
    const ask = this.store.getAsk(requestId);
    if (!ask) return;
    const peer = ask.peers.find((p) => p.peer === from);
    if (peer) peer.state = "consented";

    if (ask.internal_state === "open") {
      // CONSENT from one peer can outrun another peer's STATUS reply; force
      // the aggregate resolution first (this peer definitely isn't a plain
      // PASS), then apply CONSENT on top.
      ask.internal_state = transitionAskerState("open", { type: "STATUS_ALL_IN", anyPending: true });
    }
    if (ask.internal_state === "pending") {
      ask.internal_state = transitionAskerState("pending", { type: "CONSENT" });
    }
    this.store.putAsk(ask);
    logAsker(
      this.store,
      this.clock,
      requestId,
      "consent_received",
      "Someone can help.",
      ask.peers.map((p) => p.peer)
    );
  }

  private askerHandleIntro(from: string, requestId: string, roomId: string): void {
    const ask = this.store.getAsk(requestId);
    if (!ask || ask.internal_state !== "consented") return;
    ask.internal_state = transitionAskerState("consented", { type: "ROOM_CREATED" });
    ask.room_id = roomId;
    this.store.putAsk(ask);
    this.store.putRoom({
      room_id: roomId,
      request_id: requestId,
      peers: [
        { peer_id: this.cfg.peerId, display: this.cfg.personaName },
        { peer_id: from, display: from },
      ],
      context: ask.text,
      created_at: this.clock.now().toISOString(),
    });
    logAsker(this.store, this.clock, requestId, "room_opened", "Room opened.", [from]);
  }

  // ---------------------------------------------------------- owner side --

  private async ownerHandleRequest(from: string, env: Extract<Envelope, { type: "REQUEST" }>): Promise<void> {
    const requestId = env.request_id;
    const receivedAt = this.clock.now();
    const edge = this.store.getTrustEdge(from);
    const items = this.store.getItems();
    const evaluations = new Map(items.map((item) => [item.id, evaluatePolicy(item, env.body, edge, receivedAt)]));
    const eligibleItems = items.filter((item) => evaluations.get(item.id)!.eligible);

    const dispatchAt = statusDispatchAt(receivedAt, this.cfg.statusDelayMs);

    let matched: { item: Item; needsConsent: boolean } | undefined;
    if (eligibleItems.length > 0) {
      const result = await matchRequestToItems(env.body.text, eligibleItems, this.matcherDeps);
      for (const s of result.scores) {
        logOwner(this.store, this.clock, requestId, "match_score", `stage=${s.stage} item=${s.item_id} score=${s.score.toFixed(4)} — ${s.detail}`);
      }
      if (result.matched && result.item_id) {
        const item = this.store.getItem(result.item_id)!;
        matched = { item, needsConsent: evaluations.get(item.id)!.needsConsent };
      }
    } else {
      logOwner(this.store, this.clock, requestId, "no_eligible_items", "No item is policy-eligible for this requester.");
    }

    if (!matched) {
      logOwner(this.store, this.clock, requestId, "no_match", "No eligible item matched this request; PASS scheduled at uniform delay.");
      this.scheduler.scheduleAt(dispatchAt, async () => {
        await this.transport.send(from, statusEnvelope(requestId, this.clock.now(), "PASS"));
        logOwner(this.store, this.clock, requestId, "status_pass", "Sent PASS (no eligible match).");
        this.notifyChange();
      });
      this.notifyChange();
      return;
    }

    const cardId = randomUUID();
    const kind: IncomingKind = matched.item.provenance.kind === "second_brain" ? "relay" : "direct";
    const autoForward = !matched.needsConsent;

    const record: IncomingRecord = {
      card_id: cardId,
      request_id: requestId,
      requester_peer: from,
      requester_display: edge?.display ?? from,
      text: env.body.text,
      received_at: receivedAt.toISOString(),
      matched_item_id: matched.item.id,
      kind,
      state: autoForward ? "consented" : "pending",
      internal_state: autoForward ? "consented" : "matched",
      status_dispatch_at: dispatchAt,
      status_dispatched: false,
    };
    this.store.putIncoming(record);

    if (autoForward) {
      logOwner(this.store, this.clock, requestId, "auto_forward_consent", `Auto-forwarded (policy mode=auto_forward) for item ${matched.item.id}.`);
    } else {
      logOwner(this.store, this.clock, requestId, "consent_card_created", `Consent card created for item ${matched.item.id}; awaiting owner decision.`);
    }

    this.scheduler.scheduleAt(dispatchAt, () => this.dispatchOwnerStatus(cardId));
    this.notifyChange();
  }

  /**
   * I3 core: the ONLY place a STATUS is sent for a matched request. Content
   * is computed from the card's state AT THIS MOMENT (fire time), never from
   * whatever the state was when this callback was scheduled — that's what
   * makes a decline-before-dispatch produce the exact same PASS as a genuine
   * no-match (see ownerHandleRequest's no-match branch, which builds the
   * byte-identical PASS via the same `statusEnvelope(requestId, ts, "PASS")`).
   */
  private async dispatchOwnerStatus(cardId: string): Promise<void> {
    const card = this.store.getIncoming(cardId);
    if (!card || card.status_dispatched) return;
    card.status_dispatched = true;
    this.store.putIncoming(card);

    const ts = this.clock.now();
    if (card.state === "declined" || card.state === "inactive") {
      await this.transport.send(card.requester_peer, statusEnvelope(card.request_id, ts, "PASS"));
      card.internal_state = transitionOwnerState("matched", { type: "CONSENT_DECISION", accepted: false });
      this.store.putIncoming(card);
      logOwner(
        this.store,
        this.clock,
        card.request_id,
        "status_pass",
        card.state === "inactive" ? "Sent PASS (request was withdrawn before dispatch)." : "Sent PASS (declined before dispatch — indistinguishable from no-match, I3)."
      );
      this.notifyChange();
      return;
    }

    await this.transport.send(card.requester_peer, statusEnvelope(card.request_id, ts, "PENDING"));
    logOwner(this.store, this.clock, card.request_id, "status_pending", "Sent PENDING at uniform delay.");

    if (card.state === "consented") {
      await this.completeConsent(card.card_id);
    }
    this.notifyChange();
  }

  async consent(cardId: string, conditions?: string): Promise<void> {
    const card = this.store.getIncoming(cardId);
    if (!card) throw new Error(`consent: unknown card ${cardId}`);
    if (card.state !== "pending") throw new Error(`consent: card ${cardId} is not pending (state=${card.state})`);
    card.state = "consented";
    card.conditions = conditions;
    this.store.putIncoming(card);
    logOwner(this.store, this.clock, card.request_id, "consented", `Owner consented to share item ${card.matched_item_id}.` + (conditions ? ` Conditions: ${conditions}` : ""));
    if (card.status_dispatched) {
      await this.completeConsent(cardId);
    }
    // else: dispatchOwnerStatus (already scheduled) will see state === "consented"
    // once it fires, send PENDING, then call completeConsent itself.
    this.notifyChange();
  }

  async decline(cardId: string): Promise<void> {
    const card = this.store.getIncoming(cardId);
    if (!card) throw new Error(`decline: unknown card ${cardId}`);
    if (card.state !== "pending") throw new Error(`decline: card ${cardId} is not pending (state=${card.state})`);
    card.state = "declined";
    this.store.putIncoming(card);
    logOwner(this.store, this.clock, card.request_id, "declined", `Owner declined to share item ${card.matched_item_id}.`);
    // I3: if status_dispatched is already true, PENDING already went out —
    // decline now sends NOTHING further (silence). If not yet dispatched,
    // dispatchOwnerStatus will see state === "declined" and send PASS.
    this.notifyChange();
  }

  private async completeConsent(cardId: string): Promise<void> {
    const card = this.store.getIncoming(cardId)!;
    const item = this.store.getItem(card.matched_item_id!)!;
    const contextCard = `${card.text} — matched: ${item.labels[0]}${card.conditions ? ` (conditions: ${card.conditions})` : ""}`;

    const { room_id } = await this.transport.createSharedRoom([this.cfg.peerId, card.requester_peer], {
      request_id: card.request_id,
      context_card: contextCard,
    });
    this.store.putRoom({
      room_id,
      request_id: card.request_id,
      peers: [
        { peer_id: this.cfg.peerId, display: this.cfg.personaName },
        { peer_id: card.requester_peer, display: card.requester_display },
      ],
      context: contextCard,
      created_at: this.clock.now().toISOString(),
    });

    await this.transport.send(card.requester_peer, consentEnvelope(card.request_id, this.clock.now(), card.conditions));
    await this.transport.send(card.requester_peer, introEnvelope(card.request_id, this.clock.now(), room_id));

    card.internal_state = "consented";
    this.store.putIncoming(card);
    logOwner(this.store, this.clock, card.request_id, "room_created", `Room ${room_id} created; CONSENT + INTRO sent.`);
  }

  private ownerHandleWithdrawn(from: string, requestId: string): void {
    const card = this.store.getIncomingByRequestAndPeer(requestId, from);
    if (!card) return;
    if (card.state === "pending") {
      card.state = "inactive";
      this.store.putIncoming(card);
      logOwner(this.store, this.clock, requestId, "requester_withdrew", "Requester withdrew; consent card marked inactive.");
    }
  }

  // ------------------------------------------------------------- rooms --

  async postRoomMessage(roomId: string, text: string): Promise<void> {
    const room = this.store.getRoom(roomId);
    if (!room) throw new Error(`postRoomMessage: unknown room ${roomId}`);
    const ts = this.clock.now().toISOString();
    this.store.addRoomMessage({ room_id: roomId, from: this.cfg.peerId, text, ts });
    if (hasRoomMessaging(this.transport)) {
      await this.transport.sendRoomMessage({ room_id: roomId, from: this.cfg.peerId, text, ts });
    }
    this.notifyChange();
  }

  private onRoomMessage(msg: RoomMessage): void {
    const room = this.store.getRoom(msg.room_id);
    if (!room) return;
    this.store.addRoomMessage(msg);
    this.notifyChange();
  }

  // ---------------------------------------------------------------- steward --

  async handleSteward(text: string): Promise<string> {
    const stewardDeps: StewardDeps = {
      store: this.store,
      clock: this.clock,
      chatClient: this.deps.chatClient,
      chatModel: this.cfg.matcher.chatModel,
      sendAsk: (t, opts) => this.sendAsk(t, opts),
    };
    this.store.addStewardLog({ role: "user", text, ts: this.clock.now().toISOString() });
    const reply = await classifyAndRespond(text, stewardDeps);
    this.store.addStewardLog({ role: "agent", text: reply, ts: this.clock.now().toISOString() });
    this.notifyChange();
    return reply;
  }

  // -------------------------------------------------------------- routing --

  private async handleEnvelope(from: string, env: Envelope): Promise<void> {
    switch (env.type) {
      case "REQUEST":
        await this.ownerHandleRequest(from, env);
        break;
      case "STATUS":
        this.askerHandleStatus(from, env.request_id, env.body.state);
        break;
      case "CONSENT":
        this.askerHandleConsent(from, env.request_id, env.body.conditions);
        break;
      case "INTRO":
        this.askerHandleIntro(from, env.request_id, env.body.room_id);
        break;
      case "WITHDRAWN":
        this.ownerHandleWithdrawn(from, env.request_id);
        break;
    }
    this.notifyChange();
  }
}
