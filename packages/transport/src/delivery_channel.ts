// DeliveryChannel — the bidirectional seam behind which all transport-layer
// variance (LAN HTTP, relay, WebRTC, …) lives (see .superpowers/sdd/
// core-transport-plan.md §1.1). DidCommTransport packs/unpacks the JWM
// envelope and owns dispatch/replay-protection; a DeliveryChannel only moves
// an already-packed wire string to/from a peer. No channel implementation
// ever decrypts or dispatches — every inbound wire is handed verbatim to the
// channel's registered sink, which DidCommTransport wires to its own
// (unchanged) receiveInbound(), so there is exactly one decrypt/verify/
// dispatch path regardless of how many rungs a future ladder adds.
import type { Identity } from "./did_identity.js";
import { resolveDidPeer } from "./did_identity.js";

/** Injectable HTTP POST for tests; defaults to global fetch. Throws on non-2xx. */
export type HttpPost = (url: string, body: string) => Promise<void>;

export const defaultHttpPost: HttpPost = async (url, body) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  if (!res.ok) {
    throw new Error(`HttpPostChannel: POST ${url} failed with ${res.status}`);
  }
  // Drain the body so the socket can be reused/closed.
  await res.text().catch(() => undefined);
};

export interface DeliveryChannel {
  /** Deliver an already-packed wire string to recipientDid. Throws on failure (caller decides fallback). */
  deliver(recipientDid: string, wire: string): Promise<void>;
  /** Register the sink for inbound wire strings; each is passed verbatim to transport.receiveInbound. */
  onInbound(cb: (wire: string) => void): void;
  /** Optional readiness probe; a channel that can never work (missing native module) returns false. */
  isAvailable?(): Promise<boolean>;
  close?(): Promise<void>;
}

export interface HttpPostChannelOptions {
  httpPost?: HttpPost;
}

/**
 * Default channel: resolve the recipient's did:peer:2 service endpoint and
 * POST — today's DidCommTransport behavior, verbatim (rung "c", the LAN HTTP
 * floor). Inbound HTTP stays mounted by the daemon at `POST /didcomm`, which
 * calls `transport.receiveInbound` directly — so `onInbound` here is a no-op
 * sink; wiring it up would create a second dispatch path.
 */
export class HttpPostChannel implements DeliveryChannel {
  private readonly httpPost: HttpPost;

  // `identity` is unused today (resolveDidPeer is pure and needs no local
  // key material to resolve a peer's endpoint) but is part of the documented
  // constructor signature (core-transport-plan.md Task 1) for symmetry with
  // future channels that DO need it (e.g. signing/authenticating a drain).
  constructor(private readonly identity: Identity, opts: HttpPostChannelOptions = {}) {
    this.httpPost = opts.httpPost ?? defaultHttpPost;
  }

  async deliver(recipientDid: string, wire: string): Promise<void> {
    const endpoint = resolveDidPeer(recipientDid).serviceEndpoint;
    await this.httpPost(endpoint, wire);
  }

  onInbound(_cb: (wire: string) => void): void {
    // No-op: HTTP inbound is mounted separately at POST /didcomm and calls
    // transport.receiveInbound directly (see server.ts). Never call cb here.
  }
}
