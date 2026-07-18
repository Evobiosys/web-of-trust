// DidCommTransport — a DIDComm-v2-SHAPED TransportAdapter over plain HTTP.
//
// The OpenVTC pillar's peer-to-peer transport. Every message is sign-then-
// encrypted (see didcomm_crypto.ts) and POSTed directly to the recipient's
// service endpoint (resolved from their did:peer:2 — no homeserver, no
// mediator, no directory). This is the metadata-privacy win over Matrix: there
// is no third party that sees who talks to whom (PRIVACY.md).
//
// HONEST LABELING (I7): "DIDComm v2-shaped, not certified-interoperable yet".
// We reuse DIDComm's concepts (DIDs, JWM-shaped messages, ECDH-ES + AEAD,
// sign-then-encrypt) but NOT its exact JWE/JWM serialization, so this will not
// interoperate with a conformant DIDComm agent. docs/TRANSPORT.md lists the
// deviations precisely.
//
// Rooms: DIDComm has no native rooms, so `createSharedRoom` mints a uuid and
// fans a ROOM_CREATE control message to every member (so each peer's transport
// learns the membership); room chat then fans out member-to-member. This
// mirrors agent-daemon's RoomMessagingTransport extension structurally (it is
// duck-typed via `hasRoomMessaging`), so no agent-daemon import is needed.
import { parseEnvelope, serializeEnvelope } from "@resource-web/protocol";
import type { Envelope, PeerId, RoomContext, TransportAdapter, TransportConfig } from "@resource-web/protocol";
import { v4 as uuidv4 } from "uuid";
import type { Identity } from "./did_identity.js";
import { packMessage, unpackMessage, type JwmMessage } from "./didcomm_crypto.js";
import { HttpPostChannel, type DeliveryChannel, type HttpPost } from "./delivery_channel.js";
import { InMemoryDedupStore, MAX_HOLD_HORIZON_MS, type DedupStore } from "./dedup_store.js";

// JWM `type` discriminators (DIDComm-shaped app-protocol URIs).
export const ENVELOPE_TYPE = "https://didcomm.org/resource-web/2.0/envelope";
export const ROOM_MESSAGE_TYPE = "https://didcomm.org/resource-web/2.0/room-message";
export const ROOM_CREATE_TYPE = "https://didcomm.org/resource-web/2.0/room-create";

/** Structurally compatible with agent-daemon's RoomMessage (duck-typed; no cross-package import). */
export interface RoomMessage {
  room_id: string;
  from: PeerId;
  text: string;
  ts: string;
}

type EnvelopeListener = (from: PeerId, env: Envelope) => void;
type RoomMessageListener = (msg: RoomMessage) => void;

// `HttpPost` re-exported for back-compat; the type and default implementation
// now live in delivery_channel.ts (the HttpPostChannel is the default rung).
export type { HttpPost };

// Freshness horizon `H`: messages older than this (or duplicate ids recorded
// within it) are rejected. This is also the dedup store's retention window —
// the two are deliberately the *same* constant. Store-and-forward legitimately
// delivers messages up to H old (the recipient was offline when sent); widening
// freshness without widening dedup retention by the same amount would reopen a
// replay hole (core-transport-plan.md §1 "Load-bearing finding" + Task 2).
const FUTURE_SKEW_MS = 60_000;

export interface DidCommTransportOptions {
  /** Back-compat: overrides the POST implementation of the default HttpPostChannel. Ignored if `channel` is given. */
  httpPost?: HttpPost;
  /** The delivery seam (see delivery_channel.ts). Defaults to an HttpPostChannel — today's exact behavior. */
  channel?: DeliveryChannel;
  /** Replay-protection memory (see dedup_store.ts). Defaults to InMemoryDedupStore — today's exact behavior. */
  dedup?: DedupStore;
}

export class DidCommTransport implements TransportAdapter {
  private readonly listeners: EnvelopeListener[] = [];
  private readonly roomListeners: RoomMessageListener[] = [];
  private readonly rooms = new Map<string, PeerId[]>();
  private readonly dedup: DedupStore;
  private readonly channel: DeliveryChannel;
  private self: PeerId | undefined;

  constructor(private readonly identity: Identity, opts: DidCommTransportOptions = {}) {
    this.channel = opts.channel ?? new HttpPostChannel(identity, { httpPost: opts.httpPost });
    this.dedup = opts.dedup ?? new InMemoryDedupStore();
  }

  async init(cfg: TransportConfig): Promise<void> {
    // The daemon addresses peers by DID; self MUST be this identity's DID.
    if (cfg.self && cfg.self !== this.identity.did) {
      throw new Error(
        `DidCommTransport.init: cfg.self (${cfg.self}) does not match the loaded identity DID. ` +
          "Set PEER_ID to the identity DID (main.ts does this for TRANSPORT=didcomm)."
      );
    }
    this.self = this.identity.did;
    // Every inbound wire the channel produces funnels into the unchanged
    // receiveInbound path — no second decrypt/verify/dispatch path is ever
    // created (core-transport-plan.md §1 rule 1). HttpPostChannel's onInbound
    // is a no-op: HTTP inbound stays mounted at POST /didcomm, which calls
    // receiveInbound directly.
    // receiveInbound rejects on EXPECTED inbound errors (duplicate/replay,
    // too-old past H, future-skew, tampered ciphertext) — it logs the reason
    // itself before throwing so the HTTP route can answer 4xx. On the
    // channel-driven path (relay/ladder rungs) there is no response to send and
    // duplicates are normal (store-and-forward re-drain, cross-rung delivery,
    // all absorbed by the dedup store), so swallow the rejection here to avoid
    // an unhandled promise rejection taking down the process. The reason is
    // already logged inside receiveInbound.
    this.channel.onInbound((wire) => {
      void this.receiveInbound(wire).catch(() => {});
    });
  }

  private requireSelf(): PeerId {
    if (!this.self) throw new Error("DidCommTransport used before init()");
    return this.self;
  }

  private async deliver(recipientDid: string, message: JwmMessage): Promise<void> {
    const wire = packMessage({ sender: this.identity, recipientDid, message });
    await this.channel.deliver(recipientDid, wire);
  }

  private buildMessage(type: string, to: string, body: unknown): JwmMessage {
    return {
      id: uuidv4(),
      type,
      from: this.identity.did,
      to: [to],
      created_time: Date.now(),
      body,
    };
  }

  async send(peer: PeerId, env: Envelope): Promise<void> {
    this.requireSelf();
    // Validate/normalize through the protocol serializer, then carry the
    // parsed object as the JWM body (re-validated on the far side).
    const normalized = JSON.parse(serializeEnvelope(env)) as unknown;
    await this.deliver(peer, this.buildMessage(ENVELOPE_TYPE, peer, normalized));
  }

  onEnvelope(cb: EnvelopeListener): void {
    this.listeners.push(cb);
  }

  async createSharedRoom(peers: PeerId[], _context: RoomContext): Promise<{ room_id: string }> {
    void _context;
    const self = this.requireSelf();
    const room_id = uuidv4();
    const members = [...peers];
    this.rooms.set(room_id, members);
    // Fan a ROOM_CREATE control message so every other member's transport
    // learns the membership and can itself fan out room chat later.
    await Promise.all(
      members
        .filter((m) => m !== self)
        .map((m) => this.deliver(m, this.buildMessage(ROOM_CREATE_TYPE, m, { room_id, members })))
    );
    return { room_id };
  }

  // ---- RoomMessagingTransport (duck-typed extension; see hasRoomMessaging) --

  async sendRoomMessage(msg: RoomMessage): Promise<void> {
    const self = this.requireSelf();
    const members = this.rooms.get(msg.room_id) ?? [];
    await Promise.all(
      members
        .filter((m) => m !== self && m !== msg.from)
        .map((m) => this.deliver(m, this.buildMessage(ROOM_MESSAGE_TYPE, m, msg)))
    );
  }

  onRoomMessage(cb: RoomMessageListener): void {
    this.roomListeners.push(cb);
  }

  // ---- inbound ----------------------------------------------------------

  /**
   * Decrypt + verify one inbound wire message and dispatch it. Mounted by the
   * daemon at `POST /didcomm`. Never throws the daemon's cascade back to the
   * HTTP caller: on success it fires listeners and returns; on any crypto /
   * validation / replay failure it logs (audit wiring is another task) and
   * throws so the HTTP layer can answer 4xx. Returns without awaiting the
   * daemon's downstream processing.
   */
  async receiveInbound(rawBody: string): Promise<void> {
    let from: string;
    let message: JwmMessage;
    try {
      ({ from, message } = unpackMessage({ recipient: this.identity, wire: rawBody }));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[didcomm] rejected inbound message: ${(err as Error).message}`);
      throw err;
    }

    // Replay protection — keyed on the SIGNED message id, so only
    // authenticated messages can populate the store. Freshness lower-bound is
    // the max-hold horizon H (store-and-forward can legitimately deliver a
    // message up to H old); dedup retention is the same H, so the two checks
    // stay coupled (see the constant's doc comment).
    const now = Date.now();
    this.dedup.prune(now);
    if (typeof message.created_time !== "number" || message.created_time < now - MAX_HOLD_HORIZON_MS) {
      const reason = "message too old / missing created_time (exceeds max-hold horizon)";
      // eslint-disable-next-line no-console
      console.error(`[didcomm] rejected inbound from ${from}: ${reason} (id=${message.id})`);
      throw new Error(`[didcomm] ${reason}`);
    }
    if (message.created_time > now + FUTURE_SKEW_MS) {
      // eslint-disable-next-line no-console
      console.error(`[didcomm] rejected inbound from ${from}: created_time in the future (id=${message.id})`);
      throw new Error("[didcomm] created_time in the future");
    }
    if (this.dedup.seen(message.id)) {
      // eslint-disable-next-line no-console
      console.error(`[didcomm] rejected duplicate inbound from ${from} (id=${message.id})`);
      throw new Error("[didcomm] duplicate message id (replay)");
    }
    this.dedup.record(message.id, message.created_time);

    this.dispatch(from, message);
  }

  private dispatch(from: string, message: JwmMessage): void {
    switch (message.type) {
      case ENVELOPE_TYPE: {
        let env: Envelope;
        try {
          env = parseEnvelope(JSON.stringify(message.body));
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(`[didcomm] dropped unparseable envelope from ${from}: ${(err as Error).message}`);
          return;
        }
        for (const l of this.listeners) l(from, env);
        return;
      }
      case ROOM_MESSAGE_TYPE: {
        const msg = message.body as RoomMessage;
        if (!msg || typeof msg.room_id !== "string" || typeof msg.text !== "string" || typeof msg.from !== "string") {
          // eslint-disable-next-line no-console
          console.error(`[didcomm] dropped malformed room message from ${from}`);
          return;
        }
        // I6: `msg.from` is an attacker-controlled body field — the only
        // trustworthy sender identity is the cryptographically authenticated
        // `from` from receiveInbound(). A mismatch is evidence of tampering
        // (e.g. a consented room member forging attribution to someone else),
        // so we reject rather than silently trust or silently relabel it.
        if (msg.from !== from) {
          // eslint-disable-next-line no-console
          console.error(
            `[didcomm] rejected room message: body.from (${msg.from}) does not match authenticated sender (${from})`
          );
          return;
        }
        for (const l of this.roomListeners) l(msg);
        return;
      }
      case ROOM_CREATE_TYPE: {
        const body = message.body as { room_id?: string; members?: PeerId[] };
        if (typeof body.room_id !== "string" || !Array.isArray(body.members)) {
          // eslint-disable-next-line no-console
          console.error(`[didcomm] dropped malformed ROOM_CREATE from ${from}`);
          return;
        }
        // The authenticated sender must claim membership in the room it is
        // announcing — otherwise anyone could mint/redefine rooms they have
        // no part in.
        if (!body.members.includes(from)) {
          // eslint-disable-next-line no-console
          console.error(
            `[didcomm] rejected ROOM_CREATE for room ${body.room_id}: authenticated sender ${from} is not in the member list`
          );
          return;
        }
        const existing = this.rooms.get(body.room_id);
        if (existing) {
          // Known room: only an existing member may redefine membership, and
          // only if the new list still includes this device — otherwise a
          // member who merely knows the room_id could partition/hijack it.
          const senderIsExistingMember = existing.includes(from);
          const selfStillMember = this.self !== undefined && body.members.includes(this.self);
          if (!senderIsExistingMember || !selfStillMember) {
            // eslint-disable-next-line no-console
            console.error(
              `[didcomm] rejected ROOM_CREATE for known room ${body.room_id} from ${from}: not an existing member, or new member list would drop the local DID`
            );
            return;
          }
        }
        this.rooms.set(body.room_id, body.members);
        return;
      }
      default:
        // Unknown app type — ignore silently (forward-compat), like MatrixTransport.
        return;
    }
  }

}
