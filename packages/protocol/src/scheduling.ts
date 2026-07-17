// Uniform-STATUS scheduling helper — HANDOVER §6.1 / invariant I3.
//
// Every queried peer replies at the same fixed delay after receiving a
// REQUEST, regardless of whether their answer will be a match, a decline, or
// a no-match. This function computes only that fixed dispatch time from the
// receipt time — it must never be handed the matching/consent outcome, since
// that outcome must not influence *when* the STATUS goes out (only *what* it
// says, and even then only PASS vs PENDING — see I3 in envelope.ts).
export function statusDispatchAt(receivedAt: Date | string, delayMs = 30_000): string {
  const received = typeof receivedAt === "string" ? new Date(receivedAt) : receivedAt;
  return new Date(received.getTime() + delayMs).toISOString();
}
