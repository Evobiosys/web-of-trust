// CredentialProvider — the credential-layer swap seam (owner decision,
// 2026-08-24: "we will use openvtc for now" behind a swappable interface).
// Mirrors protocol/src/transport_adapter.ts's TransportAdapter idiom (§5.2,
// D7, docs/PROTOCOL.md ~L335, MockTransport): one small interface, one
// battle-tested local implementation, one stub for the external target this
// repo intends to grow into. Everything above this interface (main.ts,
// api/server.ts) should talk only to `CredentialProvider`, never directly to
// `issueVrc`/`verifyVrc`/`issueScopedGrant`/`verifyScopedGrant`.
//
// PLACEMENT (task brief asked for this to be explained): a new
// `packages/credentials` package was ruled out — pnpm workspace packages
// resolve their `@resource-web/*`/`vitest`/`typescript` deps through
// symlinked `node_modules`, which only `pnpm install` creates; a brand-new
// package directory would have none, so nothing (not even this package's own
// tests) could import it without fabricating install state this task was
// told NOT to fabricate ("NO new dependencies, NO installs"). Between
// `protocol` and `transport`, `transport` is the concrete answer, not a
// stretch to reach the prettier one: `issue()`'s signature is tied to
// `Identity` (transport-owned, did:peer:2 key material) and the local
// implementation wraps `vrc.ts`/`scoped_grant.ts` directly — putting the
// interface in `protocol` would force an opaque/structural re-typing of
// `Identity` for no client that needs one yet (the one precedent for that
// technique, `server.ts`'s `RelayMediator`, exists specifically so server.ts
// can avoid importing transport's *concrete class*; here the interface's own
// consumer, `LocalVrcProvider`, IS transport code, so there is nothing to
// decouple from). This is the task's own named fallback ("packages/protocol
// or packages/transport ... following where types naturally live").
import type { Identity } from "./did_identity.js";
import { issueVrc, verifyVrc, type IssueVrcArgs, type VerifiableRelationshipCredential } from "./vrc.js";
import { issueScopedGrant, verifyScopedGrant, type IssueScopedGrantArgs, type ScopedGrantCredential } from "./scoped_grant.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomUUID } from "node:crypto";

export type CredentialKind = "relationship" | "scoped_grant";

/** The union of credential shapes this provider seam can carry. Both are
 * W3C-VC-SHAPED, Ed25519Signature2020-shaped (see vrc.ts's honest-labeling
 * header) — `kind` is what a `CredentialRecord` needs to know which verifier
 * to dispatch to; the credential's own `type[1]` also disambiguates. */
export type IssuedCredential = VerifiableRelationshipCredential | ScopedGrantCredential;

/** A persisted, provider-issued credential — the wrapper `id`/`revoked_at`
 * neither `VerifiableRelationshipCredential` nor `ScopedGrantCredential`
 * carries on the wire (see `credentialId` below for how `id` is derived). */
export interface CredentialRecord {
  id: string;
  kind: CredentialKind;
  credential: IssuedCredential;
  issued_at: string;
  revoked_at?: string;
}

export type IssueCredentialArgs =
  | ({ kind: "relationship" } & IssueVrcArgs)
  | ({ kind: "scoped_grant" } & IssueScopedGrantArgs);

export interface CredentialVerifyResult {
  valid: boolean;
  issuer?: string;
  subject?: string;
  reason?: string;
  /** Set (and `valid: false`) specifically when the signature checks out but the credential's id is on this provider's revocation status list. */
  revoked?: boolean;
}

export interface VerifiablePresentation {
  "@context": string[];
  type: ["VerifiablePresentation"];
  holder: string;
  verifiableCredential: IssuedCredential[];
  proof: {
    type: "PresentationNonce";
    nonce: string;
    audience: string;
    created: string;
  };
}

export interface PresentArgs {
  ids: string[];
  audience: string;
  /** Overrides the random nonce (tests). */
  nonce?: string;
}

/**
 * The credential-layer swap seam (issue / verify / revoke / present).
 * All methods are async so a network-backed implementation (OpenVtcProvider)
 * and a purely local, synchronous-under-the-hood one (LocalVrcProvider)
 * share one call shape.
 */
export interface CredentialProvider {
  issue(args: IssueCredentialArgs): Promise<CredentialRecord>;
  verify(credential: IssuedCredential): Promise<CredentialVerifyResult>;
  revoke(id: string): Promise<void>;
  present(args: PresentArgs): Promise<VerifiablePresentation>;
  /** Every credential this provider has issued and persisted (owner-facing; not a wire operation). */
  list(): Promise<CredentialRecord[]>;
}

/**
 * Persistence port `LocalVrcProvider` depends on — deliberately NOT an
 * import of agent-daemon's `SqliteStore` (that would be circular: agent-daemon
 * already depends on `transport`). Mirrors `relay_queue_store.ts`'s/
 * `dedup_store.ts`'s in-package-interface-plus-in-memory-default pattern;
 * agent-daemon's `SqliteStore` implements this same interface against its
 * own SQLite connection (new `credentials` table) so the whole daemon stays
 * on one DB file/connection instead of opening a second one (which would
 * silently diverge for the common `DB_PATH=":memory:"` test/dev case — two
 * separate `:memory:` connections are two separate empty databases).
 */
export interface CredentialStore {
  put(record: CredentialRecord): void;
  get(id: string): CredentialRecord | undefined;
  list(): CredentialRecord[];
  /** Marks `id` revoked as of `revokedAt` — a no-op if the id is unknown or already revoked (idempotent, append-only status-list semantics). */
  markRevoked(id: string, revokedAt: string): void;
  close?(): void;
}

function cloneRecord(record: CredentialRecord): CredentialRecord {
  return { ...record, credential: JSON.parse(JSON.stringify(record.credential)) as IssuedCredential };
}

/** In-memory default: exercised by tests and any wiring that doesn't need restart-survival — same role as `InMemoryConnectionRecordStore`/`InMemoryDedupStore`. */
export class InMemoryCredentialStore implements CredentialStore {
  private readonly rows = new Map<string, CredentialRecord>();

  /** Revocation is append-only and sticky: if `record.id` collides with an
   * already-revoked row (possible when the SAME issuer+subject+relationship
   * is re-issued within the same clock-resolution tick after a revoke,
   * since the credential's signed content — and therefore its derived id —
   * is then byte-identical to the one that was just revoked), the existing
   * `revoked_at` wins rather than being silently cleared by the overwrite.
   * Without this, `revoke(id)` would be reversible by re-issuing, which
   * defeats the point of a status list. */
  put(record: CredentialRecord): void {
    const existing = this.rows.get(record.id);
    const toStore = existing?.revoked_at !== undefined ? { ...record, revoked_at: existing.revoked_at } : record;
    this.rows.set(record.id, cloneRecord(toStore));
  }

  get(id: string): CredentialRecord | undefined {
    const row = this.rows.get(id);
    return row ? cloneRecord(row) : undefined;
  }

  list(): CredentialRecord[] {
    return [...this.rows.values()].map(cloneRecord);
  }

  markRevoked(id: string, revokedAt: string): void {
    const row = this.rows.get(id);
    if (row && row.revoked_at === undefined) row.revoked_at = revokedAt;
  }
}

/** Deterministic id for a signed credential: sha256 hex of its full JSON
 * (proof included). Both `issueVrc`/`issueScopedGrant` build their return
 * object with a fixed, literal key order, so `JSON.stringify` is already
 * deterministic here without re-canonicalizing — no need to duplicate
 * vrc.ts's `canonicalize` a second time just to hash. The signed proof
 * (`proof.jws`) is already unique per issuer+subject+issuanceDate, so this
 * id is unique by construction; hashing the whole object (not just the jws)
 * additionally makes the id insensitive to which field callers hand around,
 * and keeps the id opaque rather than exposing the raw signature as a URL
 * path segment (used verbatim in `DELETE /api/trust/credentials/:id`). */
export function credentialId(credential: IssuedCredential): string {
  return Buffer.from(sha256(new TextEncoder().encode(JSON.stringify(credential)))).toString("hex");
}

function isScopedGrant(credential: IssuedCredential): credential is ScopedGrantCredential {
  return credential.type[1] === "ScopedGrantCredential";
}

/**
 * Wraps the existing `issueVrc`/`verifyVrc` (vrc.ts) and `issueScopedGrant`/
 * `verifyScopedGrant` (scoped_grant.ts) behind `CredentialProvider`, adding:
 * - persistence (via the injected `CredentialStore`; D17 gap (2) — VRCs were
 *   "issued on demand ... not persisted" — this closes that gap for whatever
 *   calls through this provider);
 * - issue-once-per-edge idempotency for relationship credentials: `issue()`
 *   looks up an existing, non-revoked credential for the same
 *   (issuer, subject, relationship) triple before minting a fresh one, so a
 *   caller that re-issues on every `/api/trust/export` (main.ts's existing
 *   per-export-cycle loop over live edges) does not grow the table
 *   unboundedly or mint duplicate credentials for a still-valid edge;
 * - a local revocation status list (`revoke(id)` appends a `revoked_at`;
 *   `verify()` checks it after the signature already passes).
 */
export class LocalVrcProvider implements CredentialProvider {
  private readonly store: CredentialStore;

  constructor(
    private readonly identity: Identity,
    options: { store?: CredentialStore } = {}
  ) {
    this.store = options.store ?? new InMemoryCredentialStore();
  }

  private findExistingRelationship(peerDid: string, relationship: string): CredentialRecord | undefined {
    return this.store.list().find(
      (r) =>
        r.kind === "relationship" &&
        r.revoked_at === undefined &&
        r.credential.issuer === this.identity.did &&
        r.credential.credentialSubject.id === peerDid &&
        (r.credential as VerifiableRelationshipCredential).credentialSubject.relationship === relationship
    );
  }

  async issue(args: IssueCredentialArgs): Promise<CredentialRecord> {
    if (args.kind === "relationship") {
      const existing = this.findExistingRelationship(args.peerDid, args.relationship);
      if (existing) return existing;
      const credential = issueVrc(this.identity, args);
      return this.persist("relationship", credential);
    }
    const credential = issueScopedGrant(this.identity, args);
    return this.persist("scoped_grant", credential);
  }

  /** Persists a freshly-minted credential and returns what the store actually
   * holds afterward (NOT the locally-built object) — `CredentialStore.put`'s
   * sticky-revocation merge (see `InMemoryCredentialStore.put`'s doc comment)
   * means those can diverge on an id collision with an already-revoked row
   * (byte-identical re-issue within the same clock-resolution tick); reading
   * back from the store is what keeps `issue()`'s return value honest about
   * that. */
  private persist(kind: CredentialKind, credential: IssuedCredential): CredentialRecord {
    const record: CredentialRecord = { id: credentialId(credential), kind, credential, issued_at: credential.issuanceDate };
    this.store.put(record);
    return this.store.get(record.id) ?? record;
  }

  async verify(credential: IssuedCredential): Promise<CredentialVerifyResult> {
    const result = isScopedGrant(credential) ? verifyScopedGrant(credential) : verifyVrc(credential);
    if (!result.valid) return result;
    const id = credentialId(credential);
    const record = this.store.get(id);
    if (record?.revoked_at !== undefined) {
      return { valid: false, reason: "credential revoked", revoked: true, issuer: result.issuer, subject: result.subject };
    }
    return result;
  }

  async revoke(id: string): Promise<void> {
    this.store.markRevoked(id, new Date().toISOString());
  }

  async present(args: PresentArgs): Promise<VerifiablePresentation> {
    const verifiableCredential = args.ids.map((id) => this.store.get(id)).filter((r): r is CredentialRecord => r !== undefined).map((r) => r.credential);
    return {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiablePresentation"],
      holder: this.identity.did,
      verifiableCredential,
      proof: {
        type: "PresentationNonce",
        nonce: args.nonce ?? randomUUID(),
        audience: args.audience,
        created: new Date().toISOString(),
      },
    };
  }

  async list(): Promise<CredentialRecord[]> {
    return this.store.list();
  }
}

/** Thrown by every `OpenVtcProvider` method — the point of this class is to prove the swap seam is real (compile-clean, type-conformant), not to talk to the external services yet. */
export class NotImplementedError extends Error {
  constructor(method: string) {
    super(
      `OpenVtcProvider.${method} is not implemented yet — stub only. ` +
        "Next step: git.myceli.al/markus/danubetech-openvtc runbook + D22 (DECISIONS.md)."
    );
    this.name = "NotImplementedError";
  }
}

/**
 * Endpoint configuration for the REAL external OpenVTC project (Danube
 * Tech's Verifiable Trust infrastructure) — NOT this repo's own hand-rolled
 * did:peer:2 + DIDComm-shaped + VRC-shaped stack, which this codebase's own
 * comments/docs have historically also called "OpenVTC" (see D22,
 * DECISIONS.md, for the honest-labeling split this class exists to enforce
 * going forward). Owner decision, 2026-08-24: "we will use openvtc for now"
 * — Jakob has confirmed OpenVTC is the intended first real integration, so
 * these TODOs are a concrete next-step map, not an open question.
 */
export interface OpenVtcProviderConfig {
  /** DID hosting service. TODO next step: resolve/register did:peer:2 (or the DID method OpenVTC expects) against dids.openvtc.danubetech.com:8534. */
  didHostingUrl?: string;
  /** DIDComm mediator (store-and-forward inbox for a peer without a fixed public endpoint). TODO next step: point DidCommTransport-equivalent delivery at :7037 instead of direct HTTP POST. */
  mediatorUrl?: string;
  /** VTA — Verifiable Trust Agent (issuance/verification API surface, per the runbook). TODO next step: `issue`/`verify` become HTTP calls to :8100. */
  vtaUrl?: string;
  /** VTC — Verifiable Trust Credential registry/status-list service (per the runbook). TODO next step: `revoke`/`present`/`list` become HTTP calls to :8200, replacing the local status-list table with the hosted one. */
  vtcUrl?: string;
}

/**
 * Stub implementation — compile-clean, throws `NotImplementedError` on every
 * call. Exists to demonstrate the swap seam is real (a second class
 * satisfying `CredentialProvider`, wired the same way `LocalVrcProvider` is)
 * and to carry the concrete next-step map for the real integration:
 *
 *  1. `issue()`  -> POST to `vtaUrl` per the runbook's issuance flow; the
 *     resulting credential still needs a stable `id` — TODO decide whether
 *     OpenVTC's VTC assigns one or this provider keeps deriving one the same
 *     way `credentialId()` does, for API symmetry with LocalVrcProvider.
 *  2. `verify()` -> POST to `vtaUrl`'s verification endpoint OR resolve the
 *     credential's status against `vtcUrl` directly, depending on which the
 *     runbook documents as canonical.
 *  3. `revoke()` -> POST to `vtcUrl`'s status-list update endpoint.
 *  4. `present()` -> either build the VP locally (as LocalVrcProvider does)
 *     signed with a DID hosted at `didHostingUrl`, or delegate to `vtaUrl`
 *     if OpenVTC expects to mint presentations itself — TODO confirm against
 *     the runbook once network access to the danubetech.com endpoints is
 *     available from this environment.
 *  5. `list()` -> GET from `vtcUrl`, or mirror a local cache populated by
 *     `issue()`/`verify()` responses — TODO decide once the VTC API shape is
 *     known (runbook doesn't fully specify list semantics as of this task).
 *
 * None of this dials out today; `NotImplementedError` on every call is the
 * honest state until that work starts.
 */
export class OpenVtcProvider implements CredentialProvider {
  constructor(private readonly config: OpenVtcProviderConfig = {}) {
    void this.config;
  }

  async issue(_args: IssueCredentialArgs): Promise<CredentialRecord> {
    throw new NotImplementedError("issue");
  }

  async verify(_credential: IssuedCredential): Promise<CredentialVerifyResult> {
    throw new NotImplementedError("verify");
  }

  async revoke(_id: string): Promise<void> {
    throw new NotImplementedError("revoke");
  }

  async present(_args: PresentArgs): Promise<VerifiablePresentation> {
    throw new NotImplementedError("present");
  }

  async list(): Promise<CredentialRecord[]> {
    throw new NotImplementedError("list");
  }
}
