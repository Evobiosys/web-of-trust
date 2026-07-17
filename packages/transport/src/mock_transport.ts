// MockTransport — deterministic, in-memory TransportAdapter for tests (I5 swappability proof).
//
// Design notes:
// - `send`/receive round-trip through serializeEnvelope/parseEnvelope, the
//   same wire contract MatrixTransport uses. A mock that just handed the
//   object reference across would prove nothing about I5; this one exercises
//   the identical serialize-then-parse path a real transport does.
// - Delivery is queued on a microtask (not truly synchronous) so tests must
//   await a tick after `send`, matching the async-delivery shape every real
//   transport has — this keeps callers honest instead of encouraging
//   synchronous assumptions that would break the moment Matrix is swapped in.
// - One `MockBus` per test scenario; multiple `MockTransport`s share it to
//   simulate multiple agents on one network. Room ids are a bus-wide counter
//   (`room-<n>`), not per-transport, so createSharedRoom collisions are
//   caught by the test suite the same way a shared homeserver would.
import { parseEnvelope, serializeEnvelope } from "@resource-web/protocol";
import type { Envelope, PeerId, RoomContext, TransportAdapter, TransportConfig } from "@resource-web/protocol";

type EnvelopeListener = (from: PeerId, env: Envelope) => void;

interface Mailbox {
  listeners: EnvelopeListener[];
}

export class MockBus {
  private readonly mailboxes = new Map<PeerId, Mailbox>();
  private roomCounter = 0;

  /** Registers a peer's delivery callback. Idempotent per transport instance (called once from init()). */
  register(self: PeerId, onDeliver: EnvelopeListener): void {
    const existing = this.mailboxes.get(self);
    if (existing) {
      existing.listeners.push(onDeliver);
    } else {
      this.mailboxes.set(self, { listeners: [onDeliver] });
    }
  }

  /**
   * Delivers a wire-serialized envelope to `to`'s registered listeners via a
   * queued microtask — deterministic FIFO order, still asynchronous like a
   * real transport. Silently drops delivery to a peer that never registered
   * (mirrors a real transport: nothing arrives if the recipient's client
   * never joined/started).
   */
  deliver(from: PeerId, to: PeerId, wire: string): void {
    queueMicrotask(() => {
      const mailbox = this.mailboxes.get(to);
      if (!mailbox) return;
      const env = parseEnvelope(wire);
      for (const listener of mailbox.listeners) listener(from, env);
    });
  }

  /** Bus-wide monotonic counter backing createSharedRoom's `room-<n>` ids. */
  nextRoomId(): string {
    this.roomCounter += 1;
    return `room-${this.roomCounter}`;
  }
}

export class MockTransport implements TransportAdapter {
  private self: PeerId | undefined;
  private readonly listeners: EnvelopeListener[] = [];

  constructor(private readonly bus: MockBus) {}

  async init(cfg: TransportConfig): Promise<void> {
    this.self = cfg.self;
    this.bus.register(this.self, (from, env) => {
      for (const listener of this.listeners) listener(from, env);
    });
  }

  async send(peer: PeerId, env: Envelope): Promise<void> {
    if (!this.self) throw new Error("MockTransport.send called before init()");
    const wire = serializeEnvelope(env);
    this.bus.deliver(this.self, peer, wire);
  }

  onEnvelope(cb: EnvelopeListener): void {
    this.listeners.push(cb);
  }

  async createSharedRoom(_peers: PeerId[], _context: RoomContext): Promise<{ room_id: string }> {
    return { room_id: this.bus.nextRoomId() };
  }
}
