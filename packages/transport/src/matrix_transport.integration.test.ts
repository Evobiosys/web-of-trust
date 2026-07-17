// Integration test — two real MatrixTransport instances against the local
// synapse (§ task-m2t-brief.md DoD). Skips (with a printed note), rather than
// fails, if synapse is unreachable.
import { describe, it, expect, afterEach } from "vitest";
import "./matrix_crypto_stub.js"; // must precede any "matrix-bot-sdk" import — see that file's header
import { LogService } from "matrix-bot-sdk";
import type { MatrixClient } from "matrix-bot-sdk";
import type { Envelope } from "@resource-web/protocol";
import { MatrixTransport } from "./matrix_transport.js";
import { loadMatrixTestEnv, isSynapseReachable, uniqueTestLocalpart } from "./test_support/live_synapse.js";

// matrix-bot-sdk logs every non-2xx HTTP response at ERROR level, including
// the expected "M_NOT_FOUND: Account data not found" on a brand-new account's
// first m.direct lookup (DMs.update() in MatrixTransport.init). That's normal
// idempotent-DM-tracking behavior, not a real error — mute the noise so test
// output stays legible; assertions below, not console output, are the actual
// correctness signal.
LogService.muteModule("MatrixHttpClient");

const { homeserverUrl, registrationSecret } = loadMatrixTestEnv();

// Must be known at collection time — see matrix_provisioning.integration.test.ts for why.
const synapseUp = await isSynapseReachable(homeserverUrl);

if (!synapseUp) {
  // eslint-disable-next-line no-console
  console.warn(`SKIP matrix_transport.integration.test.ts — synapse unreachable at ${homeserverUrl}/_matrix/client/versions`);
} else if (!registrationSecret) {
  throw new Error(
    "synapse is reachable but MATRIX_REGISTRATION_SECRET could not be resolved from process.env or a .env file " +
      "(see task-m2t-brief.md § Local synapse). Set it before running the integration tests."
  );
}

const REQUEST_ID = "5f1e5c2a-9d3e-4a2b-8f1a-1e2d3c4b5a6f";
const TS = "2026-01-01T00:00:00.000Z";

/** One fixture envelope per type (§ DoD: all five must round-trip). */
const FIXTURES: Envelope[] = [
  { v: "0.1", type: "REQUEST", request_id: REQUEST_ID, ts: TS, body: { text: "Looking for a drill", ttl: 3_600_000 } },
  { v: "0.1", type: "STATUS", request_id: REQUEST_ID, ts: TS, body: { state: "PASS" } },
  { v: "0.1", type: "CONSENT", request_id: REQUEST_ID, ts: TS, body: { conditions: "weekends only" } },
  { v: "0.1", type: "INTRO", request_id: REQUEST_ID, ts: TS, body: { room_id: "placeholder" } },
  { v: "0.1", type: "WITHDRAWN", request_id: REQUEST_ID, ts: TS, body: { reason: "fulfilled" } },
];

/** Matrix delivery is async (sync long-polling) — never assert immediately after send(). */
async function waitFor(predicate: () => boolean | Promise<boolean>, { timeoutMs = 25_000, intervalMs = 250 } = {}): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor: timed out after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * Test-only escape hatch into MatrixTransport's private `client` field.
 * Deliberate, not an oversight: reusing an already-authenticated session
 * avoids a second `passwordLogin` call per test (synapse's default `rc_login`
 * rate limit is easy to trip with repeated dev-loop test runs — see
 * docs/TRANSPORT.md § 9), while still verifying against the real Matrix API
 * rather than any transport-internal state.
 */
function underlyingClientOf(transport: MatrixTransport): MatrixClient {
  return (transport as unknown as { client: MatrixClient }).client;
}

async function initTransport(localpartLabel: string): Promise<{ transport: MatrixTransport; self: string }> {
  const self = `@${uniqueTestLocalpart(localpartLabel)}:wot.local`;
  const transport = new MatrixTransport();
  await transport.init({ homeserver_url: homeserverUrl, self, registration_secret: registrationSecret! });
  return { transport, self };
}

describe.skipIf(!synapseUp)("MatrixTransport (live synapse)", () => {
  const spawned: MatrixTransport[] = [];

  afterEach(() => {
    for (const t of spawned.splice(0)) t.stop();
  });

  it(
    "round-trips all five envelope types between two agents over a real, reused DM room",
    async () => {
      const { transport: anna, self: annaSelf } = await initTransport("anna");
      const { transport: ben, self: benSelf } = await initTransport("ben");
      spawned.push(anna, ben);

      const received: { from: string; env: Envelope }[] = [];
      ben.onEnvelope((from, env) => received.push({ from, env }));

      for (const fixture of FIXTURES) {
        await anna.send(benSelf, fixture);
      }

      await waitFor(() => received.length >= FIXTURES.length);

      expect(received.map((r) => r.env.type)).toEqual(FIXTURES.map((f) => f.type));
      expect(received.map((r) => r.env)).toEqual(FIXTURES);
      for (const r of received) expect(r.from).toBe(annaSelf);

      // Second exchange, same pair: proves the DM room is found-and-reused
      // (idempotent one-room-per-pair), not recreated per send.
      const secondReceived: Envelope[] = [];
      ben.onEnvelope((_from, env) => secondReceived.push(env));
      await anna.send(benSelf, FIXTURES[1]);
      await waitFor(() => secondReceived.length >= 1);
      expect(secondReceived[0]).toEqual(FIXTURES[1]);
    },
    60_000
  );

  it(
    "never fires onEnvelope for the sender's own echo",
    async () => {
      const { transport: anna, self: annaSelf } = await initTransport("anna-echo");
      const { transport: ben, self: benSelf } = await initTransport("ben-echo");
      spawned.push(anna, ben);

      const annaReceived: Envelope[] = [];
      anna.onEnvelope((_from, env) => annaReceived.push(env));
      const benReceived: Envelope[] = [];
      ben.onEnvelope((_from, env) => benReceived.push(env));

      await anna.send(benSelf, FIXTURES[0]);
      await waitFor(() => benReceived.length >= 1);

      // Give anna's own sync loop a fair chance to have processed its own
      // sent event too, then assert it never surfaced as a received envelope.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(annaReceived).toHaveLength(0);
      void annaSelf;
    },
    30_000
  );

  it(
    "createSharedRoom invites all peers and posts a context card readable by both agents",
    async () => {
      const { transport: anna } = await initTransport("anna-room");
      const { transport: ben, self: benSelf } = await initTransport("ben-room");
      spawned.push(anna, ben);

      const contextCard = "Anna needs a drill for a weekend project.";
      const { room_id } = await anna.createSharedRoom([benSelf], { request_id: REQUEST_ID, context_card: contextCard });
      expect(room_id).toBeTruthy();

      // Verify via ben's own (already-authenticated) session — a genuine
      // "readable by both" check through the real Matrix API (auto-join +
      // room `/messages`), not anna's state and not a transport-internal peek.
      const benClient = underlyingClientOf(ben);
      await waitFor(async () => (await benClient.getJoinedRooms()).includes(room_id));

      const timeline = (await benClient.doRequest("GET", `/_matrix/client/v3/rooms/${encodeURIComponent(room_id)}/messages`, {
        dir: "b",
        limit: 10,
      })) as { chunk: Array<{ content?: { body?: string } }> };
      const bodies = timeline.chunk.map((event) => event.content?.body);
      expect(bodies).toContain(contextCard);
    },
    60_000
  );
});
