// Test-only helper: locates the local synapse's config + checks reachability.
// NOT part of the public transport API (not exported from index.ts) — this is
// harness plumbing for the integration tests, not transport logic. Production
// code (agent-daemon) constructs TransportConfig from its own env; this file
// exists only so `pnpm --filter @resource-web/transport test` works out of the
// box against the sprint's local synapse without extra setup.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DEFAULT_HOMESERVER_URL = "http://localhost:8008";

// This worktree's own root, and (per task-m2t-brief.md) the main worktree's
// root, as a fallback if this worktree's own .env lacks the key — both are
// gitignored, untracked local files, read only for local test convenience.
const THIS_WORKTREE_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const MAIN_WORKTREE_ENV = "/Users/personal/Documents/SingularStructure/Projects/evobiosys/Projects/evobioSYS-sys/Projects/web-of-trust/Code/.env";

function parseDotEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1);
    const hashIdx = value.indexOf("#");
    if (hashIdx !== -1) value = value.slice(0, hashIdx);
    out[key] = value.trim();
  }
  return out;
}

function readDotEnv(envPath: string): Record<string, string> {
  if (!existsSync(envPath)) return {};
  return parseDotEnv(readFileSync(envPath, "utf8"));
}

/** Resolves MATRIX_HOMESERVER_URL / MATRIX_REGISTRATION_SECRET: process.env, then this worktree's .env, then the main worktree's .env. */
export function loadMatrixTestEnv(): { homeserverUrl: string; registrationSecret: string | undefined } {
  const thisEnv = readDotEnv(path.join(THIS_WORKTREE_ROOT, ".env"));
  const mainEnv = readDotEnv(MAIN_WORKTREE_ENV);

  const homeserverUrl =
    process.env.MATRIX_HOMESERVER_URL || thisEnv.MATRIX_HOMESERVER_URL || mainEnv.MATRIX_HOMESERVER_URL || DEFAULT_HOMESERVER_URL;
  const registrationSecret =
    process.env.MATRIX_REGISTRATION_SECRET || thisEnv.MATRIX_REGISTRATION_SECRET || mainEnv.MATRIX_REGISTRATION_SECRET;

  return { homeserverUrl, registrationSecret: registrationSecret || undefined };
}

/** True if the homeserver answers `/versions` within `timeoutMs`. Used to skip-with-note rather than fail when synapse is down. */
export async function isSynapseReachable(homeserverUrl: string, timeoutMs = 2000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${homeserverUrl}/_matrix/client/versions`, { signal: controller.signal });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

/** Unique-per-run localpart so repeated test runs never collide on a stale account. */
export function uniqueTestLocalpart(label: string): string {
  return `test-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}
