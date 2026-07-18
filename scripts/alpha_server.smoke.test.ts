#!/usr/bin/env -S node --experimental-strip-types
// alpha_server.smoke.test.ts — Task 8 DoD smoke test. Standalone tsx script
// (not vitest: it drives the SHIPPED `bootPersonas` boot code from
// alpha_server.ts directly, so a pass proves the real `pnpm alpha` path
// works, not a reimplementation — see that file's header comment). Run with:
//
//   pnpm tsx scripts/alpha_server.smoke.test.ts
//
// Boots exactly 2 personas ("anna", "ben") on ephemeral 127.0.0.1 ports with
// TRANSPORT=didcomm (real DidCommTransport over real localhost HTTP, same
// mechanism packages/agent-daemon/src/api/didcomm_lifecycle.integration.test.ts
// proves). Asserts:
//   1. GET /api/state on both ports returns 200.
//   2. Anna publishes a trusted-tier listing -> it appears in Ben's
//      GET /api/listings `received` array (all-to-all "friend" trust is
//      seeded by bootPersonas, which satisfies the "trusted" tier).
//   3. Ben borrows it -> Anna's state shows the loan (owner side) — the
//      `loans` array is asserted as the evidence.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootPersonas, shutdownAll, type BootedPersona, type PersonaConfig } from "./alpha_server.js";

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

interface StateSnapshotLike {
  listings_received: Array<{ listing_id: string; title: string }>;
  loans: Array<{ listing_id: string; role: string; state: string }>;
}

async function getJson<T>(url: string): Promise<{ status: number; body: T }> {
  const res = await fetch(url);
  const body = (await res.json()) as T;
  return { status: res.status, body };
}

async function main(): Promise<void> {
  const stateDir = mkdtempSync(join(tmpdir(), "alpha-smoke-"));
  const [annaPort, benPort] = [await freePort(), await freePort()];
  const personas: PersonaConfig[] = [
    { key: "anna", name: "Anna", port: annaPort, app: "ecstatic" },
    { key: "ben", name: "Ben", port: benPort, app: "ecstatic" },
  ];

  console.log("[smoke] booting 2 personas on 127.0.0.1 via bootPersonas()...");
  const booted = await bootPersonas(personas, { hostIp: "127.0.0.1", stateDir, apiHost: "127.0.0.1" });
  const [anna, ben] = booted as [BootedPersona, BootedPersona];

  try {
    // 1. GET /api/state on both ports OK.
    console.log("[smoke] checking GET /api/state on both ports...");
    const annaState = await getJson<{ persona: { name: string } }>(`http://127.0.0.1:${anna.port}/api/state`);
    assert.equal(annaState.status, 200, "Anna /api/state should be 200");
    assert.equal(annaState.body.persona.name, "Anna");
    const benState = await getJson<{ persona: { name: string } }>(`http://127.0.0.1:${ben.port}/api/state`);
    assert.equal(benState.status, 200, "Ben /api/state should be 200");
    assert.equal(benState.body.persona.name, "Ben");
    console.log("[smoke] PASS: both /api/state OK");

    // 2. Anna publishes a trusted-tier listing over real HTTP -> propagates to Ben via DidCommTransport.
    console.log("[smoke] Anna publishes a trusted-tier listing...");
    const publishRes = await fetch(`http://127.0.0.1:${anna.port}/api/listings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "offer",
        title: "Cordless drill",
        description: "Bosch cordless drill, good condition.",
        tier: "trusted",
      }),
    });
    assert.equal(publishRes.status, 200, "publish should succeed");
    const { listing_id: listingId } = (await publishRes.json()) as { listing_id: string };
    assert.ok(listingId, "listing_id should be returned");

    await waitFor(async () => {
      const { body } = await getJson<StateSnapshotLike>(`http://127.0.0.1:${ben.port}/api/state`);
      return body.listings_received.some((l) => l.listing_id === listingId);
    });
    console.log("[smoke] PASS: listing propagated to Ben's /api/listings received");

    // 3. Ben borrows it -> Anna (owner) sees the loan.
    console.log("[smoke] Ben requests to borrow...");
    const borrowRes = await fetch(`http://127.0.0.1:${ben.port}/api/borrow`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ listing_id: listingId, note: "Could I borrow this weekend?" }),
    });
    assert.equal(borrowRes.status, 200, "borrow should succeed");
    const { loan_id: loanId } = (await borrowRes.json()) as { loan_id: string };
    assert.ok(loanId, "loan_id should be returned");

    await waitFor(async () => {
      const { body } = await getJson<StateSnapshotLike>(`http://127.0.0.1:${anna.port}/api/state`);
      return body.loans.some((l) => l.listing_id === listingId && l.role === "owner");
    });
    const { body: annaFinal } = await getJson<StateSnapshotLike>(`http://127.0.0.1:${anna.port}/api/state`);
    const annaLoan = annaFinal.loans.find((l) => l.listing_id === listingId);
    assert.ok(annaLoan, "Anna (owner) should see the loan");
    assert.equal(annaLoan!.state, "requested");
    console.log("[smoke] PASS: Anna's state shows the loan (owner side, state=requested)");

    console.log("\n[smoke] ALL CHECKS PASSED");
  } finally {
    await shutdownAll(booted);
    rmSync(stateDir, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error("[smoke] FAILED:", err);
  process.exitCode = 1;
});
