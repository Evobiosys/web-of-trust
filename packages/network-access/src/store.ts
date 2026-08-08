// Minimal persistence for the solo demo: full-state JSON written atomically on
// every change. The daemon mount will replace this with the SQLite store.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_REQUESTER_POLICY } from "./types.js";
import type { IntroQuery, RequesterPolicy } from "./types.js";

interface PersistedState {
  queries: IntroQuery[];
  policies: Record<string, RequesterPolicy>;
}

export class QueryStore {
  private queries = new Map<string, IntroQuery>();
  private policies = new Map<string, RequesterPolicy>();

  constructor(private readonly filePath?: string) {
    if (!filePath) return;
    try {
      const raw = JSON.parse(readFileSync(filePath, "utf8")) as PersistedState;
      for (const q of raw.queries) this.queries.set(q.id, q);
      for (const [requester, policy] of Object.entries(raw.policies)) {
        this.policies.set(requester, policy);
      }
    } catch {
      // First run (or unreadable file): start empty.
    }
  }

  list(): IntroQuery[] {
    return [...this.queries.values()].sort((a, b) => b.receivedAt - a.receivedAt);
  }

  get(id: string): IntroQuery | undefined {
    return this.queries.get(id);
  }

  put(query: IntroQuery): void {
    this.queries.set(query.id, query);
    this.persist();
  }

  policyFor(requester: string): RequesterPolicy {
    return this.policies.get(requester) ?? DEFAULT_REQUESTER_POLICY;
  }

  setPolicy(requester: string, policy: RequesterPolicy): void {
    this.policies.set(requester, policy);
    this.persist();
  }

  listPolicies(): Record<string, RequesterPolicy> {
    return Object.fromEntries(this.policies);
  }

  private persist(): void {
    if (!this.filePath) return;
    const state: PersistedState = {
      queries: this.list(),
      policies: this.listPolicies(),
    };
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    renameSync(tmp, this.filePath);
  }
}
