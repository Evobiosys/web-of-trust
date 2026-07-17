// MatrixTransport — TransportAdapter over a matrix-bot-sdk MatrixClient.
//
// Design notes:
// - Account provisioning (registration/login) is delegated to
//   matrix_provisioning.ts; this file only orchestrates the client once it
//   has one.
// - One DM room per agent-pair, idempotent: `client.dms.getOrCreateDm` is
//   matrix-bot-sdk's own idempotent DM-room tracker, backed by `m.direct`
//   account data on the homeserver (survives process restarts, not just
//   this instance). `client.dms.update()` is called once after `start()` to
//   force-load that account data before the first send, so a restart never
//   races a stale/empty cache into creating a duplicate room.
// - Auto-join: AutojoinRoomsMixin accepts every invite unconditionally. v0
//   scope is a closed two-agent sim behind a private synapse instance —
//   accepting all invites is acceptable here (see docs/TRANSPORT.md); a
//   production transport would gate this by trust graph membership, but
//   that is agent-daemon's policy layer, not transport's (I5/no protocol
//   logic in transport).
// - Self-echo suppression: MatrixClient's sync includes the client's own
//   sent events. `onEnvelope` callbacks must never fire for the client's own
//   messages — filtered by comparing `event.sender` to the client's own
//   user id (resolved once via `getUserId()`, not trusted from cfg.self,
//   since the server is the source of truth for the canonical mxid).
// - Metadata hygiene: envelope payloads are logged at debug level only,
//   never info (constraint in task-m2t-brief.md).
import "./matrix_crypto_stub.js"; // must precede the matrix-bot-sdk import — see that file's header
import { AutojoinRoomsMixin, LogService, MatrixClient } from "matrix-bot-sdk";
import { parseEnvelope, serializeEnvelope } from "@resource-web/protocol";
import type { Envelope, PeerId, RoomContext, TransportAdapter, TransportConfig } from "@resource-web/protocol";
import { provisionMatrixClient } from "./matrix_provisioning.js";
import { buildEnvelopeContent, extractEnvelopeWire } from "./wire.js";

type EnvelopeListener = (from: PeerId, env: Envelope) => void;

// Minimal shape of the `m.room.message` event matrix-bot-sdk's "room.message"
// listener hands back — only the fields this transport reads.
interface RoomMessageEvent {
  sender?: string;
  content?: unknown;
}

const LOG_LABEL = "MatrixTransport";

export class MatrixTransport implements TransportAdapter {
  private client: MatrixClient | undefined;
  private self: PeerId | undefined;
  private readonly listeners: EnvelopeListener[] = [];
  private started = false;

  async init(cfg: TransportConfig): Promise<void> {
    if (!cfg.homeserver_url) {
      throw new Error("MatrixTransport.init requires cfg.homeserver_url");
    }

    if (cfg.access_token) {
      this.client = new MatrixClient(cfg.homeserver_url, cfg.access_token);
    } else {
      if (!cfg.registration_secret) {
        throw new Error("MatrixTransport.init requires cfg.access_token or cfg.registration_secret");
      }
      this.client = await provisionMatrixClient({
        homeserver_url: cfg.homeserver_url,
        self: cfg.self,
        registration_secret: cfg.registration_secret,
      });
    }

    if (cfg.display) {
      try {
        await this.client.setDisplayName(cfg.display);
      } catch (err) {
        LogService.warn(LOG_LABEL, `failed to set display name (non-fatal): ${(err as Error).message}`);
      }
    }

    AutojoinRoomsMixin.setupOnClient(this.client);
    this.client.on("room.message", (roomId: string, event: RoomMessageEvent) => this.handleRoomMessage(roomId, event));

    this.self = await this.client.getUserId();
    await this.client.start();
    this.started = true;
    // Force-load m.direct account data before the first send — see file header.
    await this.client.dms.update();
  }

  private handleRoomMessage(roomId: string, event: RoomMessageEvent): void {
    const sender = event.sender;
    if (!sender || sender === this.self) return; // never emit own echoes

    const wire = extractEnvelopeWire(event.content);
    if (wire === undefined) return; // not one of ours — ignore silently (brief: "ignore non-matching msgtypes")

    let envelope: Envelope;
    try {
      envelope = parseEnvelope(wire);
    } catch (err) {
      // Malformed/foreign envelope. Debug-level only — never log payloads at info (metadata hygiene).
      LogService.debug(LOG_LABEL, `unparseable envelope in room ${roomId} from ${sender}: ${(err as Error).message}`);
      return;
    }

    LogService.debug(LOG_LABEL, `received ${envelope.type} in room ${roomId} from ${sender}`);
    for (const listener of this.listeners) listener(sender, envelope);
  }

  private requireClient(): MatrixClient {
    if (!this.client || !this.started) {
      throw new Error("MatrixTransport used before init() completed");
    }
    return this.client;
  }

  async send(peer: PeerId, env: Envelope): Promise<void> {
    const client = this.requireClient();
    const roomId = await client.dms.getOrCreateDm(peer);
    const wire = serializeEnvelope(env);
    LogService.debug(LOG_LABEL, `sending ${env.type} to ${peer} in room ${roomId}`);
    await client.sendMessage(roomId, buildEnvelopeContent(env.type, wire));
  }

  onEnvelope(cb: EnvelopeListener): void {
    this.listeners.push(cb);
  }

  async createSharedRoom(peers: PeerId[], context: RoomContext): Promise<{ room_id: string }> {
    const client = this.requireClient();
    const room_id = await client.createRoom({
      invite: peers,
      preset: "trusted_private_chat",
      is_direct: false,
      name: `resource-web ${context.request_id}`,
    });
    await client.sendMessage(room_id, { msgtype: "m.text", body: context.context_card });
    return { room_id };
  }

  /** Stops the underlying sync loop. Not part of TransportAdapter; useful for test/process teardown. */
  stop(): void {
    this.client?.stop();
  }
}
