// @resource-web/transport — M2-T (see docs/TRANSPORT.md)
//
// Two TransportAdapter (@resource-web/protocol) implementations:
// - MatrixTransport: matrix-bot-sdk over a synapse homeserver.
// - MockTransport: deterministic in-memory adapter for tests (I5 proof).
//
// No protocol logic lives here (matching/policy/lifecycle) — this package
// only moves envelopes. Must not import agent-daemon.
export const PACKAGE = "transport";

export { MockBus, MockTransport } from "./mock_transport.js";
export { MatrixTransport } from "./matrix_transport.js";
export { provisionMatrixClient, localpartOf, derivePassword, type ProvisionConfig } from "./matrix_provisioning.js";
export { ENVELOPE_MSGTYPE, ENVELOPE_CONTENT_KEY, buildEnvelopeContent, extractEnvelopeWire } from "./wire.js";

// OpenVTC pillar (Task 11) — DID identity + DIDComm-v2-shaped transport + VRCs.
export {
  createIdentity,
  resolveDidPeer,
  serializeIdentity,
  deserializeIdentity,
  getCardPayload,
  type Identity,
  type ResolvedDid,
  type CardPayload,
} from "./did_identity.js";
export {
  DidCommTransport,
  ENVELOPE_TYPE,
  ROOM_MESSAGE_TYPE,
  ROOM_CREATE_TYPE,
  type RoomMessage as DidCommRoomMessage,
  type HttpPost,
  type DidCommTransportOptions,
} from "./didcomm_transport.js";
export { packMessage, unpackMessage, type JwmMessage } from "./didcomm_crypto.js";
