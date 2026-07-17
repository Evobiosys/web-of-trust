import type { Envelope } from "./envelope.js";
import type { PeerId } from "./schemas.js";

/**
 * §5.2 — the swap seam (I5). Transport implementations live in @resource-web/transport;
 * this interface is the only coupling point. Matrix today, DIDComm tomorrow.
 */
export interface TransportConfig {
  /** Matrix: homeserver URL. DIDComm later: mediator endpoint. */
  homeserver_url?: string;
  /** Own identity on the transport (v0: matrix user id). */
  self: PeerId;
  /** Matrix: access token, or registration shared secret for auto-provisioning. */
  access_token?: string;
  registration_secret?: string;
  /** Display name for provisioned accounts / room context. */
  display?: string;
  /** Free-form extras a concrete transport may need. */
  extra?: Record<string, string>;
}

export interface RoomContext {
  request_id: string;
  /** Human-readable context card posted into the shared room. */
  context_card: string;
}

export interface TransportAdapter {
  init(cfg: TransportConfig): Promise<void>;
  send(peer: PeerId, env: Envelope): Promise<void>;
  onEnvelope(cb: (from: PeerId, env: Envelope) => void): void;
  createSharedRoom(peers: PeerId[], context: RoomContext): Promise<{ room_id: string }>;
}
