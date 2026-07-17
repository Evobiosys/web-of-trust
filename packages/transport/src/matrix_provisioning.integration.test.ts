// Integration test — exercises real HTTP against the local synapse (§ task-m2t-brief.md DoD).
// Skips (with a printed note), rather than fails, if synapse is unreachable.
import { describe, it, expect } from "vitest";
import { provisionMatrixClient } from "./matrix_provisioning.js";
import { loadMatrixTestEnv, isSynapseReachable, uniqueTestLocalpart } from "./test_support/live_synapse.js";

const { homeserverUrl, registrationSecret } = loadMatrixTestEnv();

// Reachability must be known at collection time for `describe.skipIf` to see
// it — vitest evaluates `skipIf`'s condition when it collects tests, before
// any `beforeAll` hook has a chance to run. Top-level await blocks module
// evaluation until this resolves, which is what we want here.
const synapseUp = await isSynapseReachable(homeserverUrl);

if (!synapseUp) {
  // eslint-disable-next-line no-console
  console.warn(
    `SKIP matrix_provisioning.integration.test.ts — synapse unreachable at ${homeserverUrl}/_matrix/client/versions`
  );
} else if (!registrationSecret) {
  throw new Error(
    "synapse is reachable but MATRIX_REGISTRATION_SECRET could not be resolved from process.env or a .env file " +
      "(see task-m2t-brief.md § Local synapse). Set it before running the integration tests."
  );
}

describe.skipIf(!synapseUp)("provisionMatrixClient (live synapse)", () => {
  it(
    "registers a brand-new account, then idempotently logs into the same account on a second call",
    async () => {
      const localpart = uniqueTestLocalpart("provision");
      const self = `@${localpart}:wot.local`;

      const client1 = await provisionMatrixClient({
        homeserver_url: homeserverUrl,
        self,
        registration_secret: registrationSecret!,
      });
      expect(await client1.getUserId()).toBe(self);

      // Shared-secret registration of an existing user errors (M_USER_IN_USE) —
      // provisionMatrixClient must fall back to password login using the same
      // deterministically-derived password, and land on the same account.
      const client2 = await provisionMatrixClient({
        homeserver_url: homeserverUrl,
        self,
        registration_secret: registrationSecret!,
      });
      expect(await client2.getUserId()).toBe(self);
    },
    20_000
  );
});
