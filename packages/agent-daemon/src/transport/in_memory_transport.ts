// InMemoryTransport — the only TransportAdapter implementation this package
// owns. Used both as the default "mock" wiring in main.ts's transport factory
// AND directly by every test / the headless demo (I5: swappability proven
// without needing @resource-web/transport, which is still a stub in this
// worktree — see main.ts for the matrix-arm TODO).
//
// Multiple InMemoryTransport instances that share the same `bus` (a plain
// Map passed in, or the module-level default) can address each other by
// PeerId within one Node process — exactly what two in-process daemons
// (Anna, Ben) need for the headless demo and for lifecycle tests.
import type { Envelope } from "@resource-web/protocol";
import type { PeerId, RoomContext, TransportAdapter, TransportConfig } from "@resource-web/protocol";

interface RegisteredPeer {
  // Typed `void` per TransportAdapter's interface, but Daemon's actual
  // callback returns a Promise (TS's void-return leniency allows this
  // assignment) — deliver() awaits it (see note there) so same-process tests
  // and the headless demo can rely on `await transport.send(...)` meaning
  // "the recipient has finished processing", not just "handed off".
  onEnvelope?: (from: PeerId, env: Envelope) => void | Promise<void>;
  onRoomMessage?: (msg: RoomMessage) => void;
}

/**
 * Room chat over TransportAdapter — a documented gap-fill, not a silent
 * assumption: v0.1 protocol's Envelope union (REQUEST/STATUS/CONSENT/INTRO/
 * WITHDRAWN) has no wire type for free-text room chat, and TransportAdapter
 * exposes only `send` (peer-to-peer envelopes) + `createSharedRoom` (mint an
 * id). A real MatrixTransport would likely deliver room chat natively via the
 * homeserver's room timeline, outside our envelope model entirely. Until that
 * lands, agent-daemon defines this narrow, additive extension so InMemoryTransport
 * (and, at merge, MatrixTransport if it chooses to implement it) can carry
 * chat between two in-process/networked daemons. Lifecycle code (I5) still
 * depends on the base TransportAdapter type for the request lifecycle; room
 * chat degrades to local-echo-only if the injected transport doesn't support
 * this extension (see rooms.ts). Documented in docs/DAEMON.md.
 */
export interface RoomMessage {
  room_id: string;
  from: PeerId;
  text: string;
  ts: string;
}

export interface RoomMessagingTransport {
  sendRoomMessage(msg: RoomMessage): Promise<void>;
  onRoomMessage(cb: (msg: RoomMessage) => void): void;
}

export function hasRoomMessaging(t: TransportAdapter): t is TransportAdapter & RoomMessagingTransport {
  return typeof (t as Partial<RoomMessagingTransport>).sendRoomMessage === "function";
}

/** Shared address book a set of InMemoryTransport instances rendezvous on. */
export class InMemoryBus {
  private readonly peers = new Map<PeerId, RegisteredPeer>();
  private readonly rooms = new Map<string, PeerId[]>();
  private roomSeq = 0;

  register(peer: PeerId): RegisteredPeer {
    const entry: RegisteredPeer = {};
    this.peers.set(peer, entry);
    return entry;
  }

  async deliver(to: PeerId, from: PeerId, env: Envelope): Promise<void> {
    const target = this.peers.get(to);
    if (!target?.onEnvelope) {
      throw new Error(`InMemoryBus: no registered peer '${to}' to deliver envelope to`);
    }
    await target.onEnvelope(from, env);
  }

  createRoom(peers: PeerId[]): string {
    this.roomSeq += 1;
    const room_id = `room-${this.roomSeq}-${Math.random().toString(36).slice(2, 8)}`;
    this.rooms.set(room_id, [...peers]);
    return room_id;
  }

  deliverRoomMessage(msg: RoomMessage): void {
    const members = this.rooms.get(msg.room_id) ?? [];
    for (const peer of members) {
      if (peer === msg.from) continue;
      this.peers.get(peer)?.onRoomMessage?.(msg);
    }
  }
}

export class InMemoryTransport implements TransportAdapter, RoomMessagingTransport {
  private self: PeerId | undefined;
  private entry: RegisteredPeer | undefined;

  constructor(private readonly bus: InMemoryBus) {}

  async init(cfg: TransportConfig): Promise<void> {
    this.self = cfg.self;
    this.entry = this.bus.register(cfg.self);
  }

  async send(peer: PeerId, env: Envelope): Promise<void> {
    if (!this.self) throw new Error("InMemoryTransport.send called before init()");
    await this.bus.deliver(peer, this.self, env);
  }

  onEnvelope(cb: (from: PeerId, env: Envelope) => void): void {
    if (!this.entry) throw new Error("InMemoryTransport.onEnvelope called before init()");
    this.entry.onEnvelope = cb;
  }

  async createSharedRoom(peers: PeerId[], context: RoomContext): Promise<{ room_id: string }> {
    void context;
    return { room_id: this.bus.createRoom(peers) };
  }

  async sendRoomMessage(msg: RoomMessage): Promise<void> {
    this.bus.deliverRoomMessage(msg);
  }

  onRoomMessage(cb: (msg: RoomMessage) => void): void {
    if (!this.entry) throw new Error("InMemoryTransport.onRoomMessage called before init()");
    this.entry.onRoomMessage = cb;
  }
}
