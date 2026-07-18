#!/usr/bin/env -S node --experimental-strip-types
// alpha_server.ts — Task 8: boots N agent-daemon personas IN ONE PROCESS for
// the one-command LAN alpha (`pnpm alpha`). Each persona gets its own DID
// identity + SQLite store + REST/WS server bound on 0.0.0.0, wired to a real
// DidCommTransport (localhost/LAN HTTP, Task 11's OpenVTC pillar — same
// mechanism the two-daemon integration test in
// packages/agent-daemon/src/api/didcomm_lifecycle.integration.test.ts proves
// works over real HTTP).
//
// `bootPersonas` is the reusable core: the CLI entry point below calls it with
// personas read from alpha/personas.json + the detected LAN IP, and
// scripts/alpha_server.smoke.test.ts calls it directly with 2 ephemeral-port
// personas on 127.0.0.1 — so the smoke test exercises this exact boot code,
// not a reimplementation.
//
// Coordination note (Task 8 brief): this script touches only
// packages/agent-daemon's *public class surface* via relative src imports
// (the same pattern packages/agent-daemon/src/main.ts and its own integration
// test already use) — no daemon internals are modified.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DidCommTransport,
  createIdentity,
  serializeIdentity,
  deserializeIdentity,
  getCardPayload,
  issueVrc,
  type Identity,
  type VerifiableRelationshipCredential,
} from "@resource-web/transport";
import { SqliteStore } from "../packages/agent-daemon/src/store/sqlite_store.js";
import { SystemClock, RealScheduler } from "../packages/agent-daemon/src/clock.js";
import { OllamaChatClient, OllamaEmbedClient } from "../packages/agent-daemon/src/matcher/clients.js";
import { DEFAULT_MATCH_THRESHOLD } from "../packages/agent-daemon/src/matcher/matcher.js";
import { Daemon, type DaemonConfig } from "../packages/agent-daemon/src/daemon/daemon.js";
import { startServer, type StartedServer } from "../packages/agent-daemon/src/api/server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

export interface PersonaConfig {
  key: string;
  name: string;
  port: number;
  app: string;
}

export interface BootedPersona {
  key: string;
  name: string;
  port: number;
  app: string;
  did: string;
  daemon: Daemon;
  store: SqliteStore;
  server: StartedServer;
}

export interface BootOptions {
  /** LAN IP (or hostname) advertised in each persona's DID service endpoint + printed join URLs. */
  hostIp: string;
  /** Directory holding `<key>/identity.json` + `<key>/state.db` per persona. */
  stateDir: string;
  /** Bind address for each daemon's HTTP server. Default "0.0.0.0" (LAN-open — see ALPHA.md's security box). */
  apiHost?: string;
  /** Skip seeding all-to-all trust edges (used by callers that want to seed differently, e.g. tests). Default false. */
  skipTrustSeed?: boolean;
  ollamaUrl?: string;
}

/**
 * Loads a persona's did:peer:2 identity from `path`, minting + persisting a
 * fresh one if the file does not exist. Mirrors main.ts's
 * `loadOrCreateIdentity` exactly (duplicated rather than imported: that
 * function is private to main.ts and this script must not modify daemon
 * internals).
 *
 * NOTE: a did:peer:2 bakes its service endpoint into the DID string itself,
 * so an existing identity is loaded as-is even if `hostIp` changed since it
 * was minted (e.g. a new WiFi network/DHCP lease) — the DID is also this
 * persona's trust-edge peer id, so silently reminting would orphan every
 * trust edge that references it. If join URLs stop working after a network
 * change, delete `alpha/state/` and let the next `pnpm alpha` remint fresh
 * identities (see ALPHA.md's troubleshooting section).
 */
function loadOrCreateIdentity(path: string, endpoint: string): Identity {
  if (existsSync(path)) {
    return deserializeIdentity(readFileSync(path, "utf8"));
  }
  const identity = createIdentity(endpoint);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeIdentity(identity), { encoding: "utf8", mode: 0o600 });
  return identity;
}

/**
 * Boots every persona in `personas` in this one process: identity -> store ->
 * DidCommTransport -> Daemon -> REST/WS server, in that order for ALL
 * personas (identities first) before seeding trust, because trust edges are
 * keyed by DID and DIDs only exist after `loadOrCreateIdentity`.
 */
export async function bootPersonas(personas: PersonaConfig[], opts: BootOptions): Promise<BootedPersona[]> {
  const apiHost = opts.apiHost ?? "0.0.0.0";
  const ollamaUrl = opts.ollamaUrl ?? process.env.OLLAMA_URL ?? "http://localhost:11434";

  // Pass 1: identities (needed up front — a persona's DID is its peer id AND
  // the value every OTHER persona's trust edge points at).
  const identities = new Map<string, Identity>();
  for (const persona of personas) {
    const personaDir = join(opts.stateDir, persona.key);
    mkdirSync(personaDir, { recursive: true });
    const endpoint = `http://${opts.hostIp}:${persona.port}/didcomm`;
    identities.set(persona.key, loadOrCreateIdentity(join(personaDir, "identity.json"), endpoint));
  }

  // Pass 2: store + transport + daemon + server, per persona.
  const booted: BootedPersona[] = [];
  for (const persona of personas) {
    const identity = identities.get(persona.key)!;
    const personaDir = join(opts.stateDir, persona.key);
    const store = new SqliteStore(join(personaDir, "state.db"));
    const transport = new DidCommTransport(identity);
    const clock = new SystemClock();

    const config: DaemonConfig = {
      personaName: persona.name,
      peerId: identity.did,
      accent: "neutral",
      statusDelayMs: 30_000, // I3: uniform PASS/PENDING delay, no jitter.
      defaultAskTtlMs: 86_400_000,
      matcher: { embedModel: "qwen3-embedding:8b", chatModel: "qwen3:4b", threshold: DEFAULT_MATCH_THRESHOLD },
    };

    const daemon = new Daemon({
      config,
      store,
      transport,
      scheduler: new RealScheduler(clock),
      clock,
      embedClient: new OllamaEmbedClient({ baseUrl: ollamaUrl }),
      chatClient: new OllamaChatClient({ baseUrl: ollamaUrl }),
    });
    await daemon.init();

    const server = await startServer(daemon, persona.port, {
      host: apiHost,
      didcommInbound: (rawBody: string) => transport.receiveInbound(rawBody),
      trustExport: (): VerifiableRelationshipCredential[] => {
        const now = Date.now();
        return store
          .getTrustEdges()
          .filter((edge) => new Date(edge.expires_at).getTime() > now)
          .map((edge) => issueVrc(identity, { peerDid: edge.peer, relationship: "trusted" }));
      },
      cardExtra: getCardPayload(identity, persona.name),
    });

    booted.push({ key: persona.key, name: persona.name, port: persona.port, app: persona.app, did: identity.did, daemon, store, server });
  }

  if (!opts.skipTrustSeed) seedAllToAllTrust(booted);

  return booted;
}

/** All-to-all "friend"-level trust edges, idempotent: skips any (persona, peer) pair whose edge already exists. */
function seedAllToAllTrust(booted: BootedPersona[]): void {
  const nowIso = new Date().toISOString();
  const expiresIso = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
  let seeded = 0;
  for (const a of booted) {
    for (const b of booted) {
      if (a.key === b.key) continue;
      if (a.store.getTrustEdge(b.did)) continue; // already seeded (idempotent re-run)
      a.store.putTrustEdge({ peer: b.did, display: b.name, level: "friend", created_at: nowIso, expires_at: expiresIso });
      seeded += 1;
    }
  }
  // eslint-disable-next-line no-console
  console.log(`[alpha_server] seeded ${seeded} trust edge(s) (${booted.length * (booted.length - 1) - seeded} already present)`);
}

/** Closes every booted persona's server + store. Safe to call once; awaits full shutdown before returning. */
export async function shutdownAll(booted: BootedPersona[]): Promise<void> {
  await Promise.all(
    booted.map(async (p) => {
      await p.server.close();
      p.store.close();
    })
  );
}

/** `HOST_IP` env override, else `ipconfig getifaddr en0` -> `en1` -> `127.0.0.1` (macOS). */
export function detectHostIp(env: NodeJS.ProcessEnv = process.env): string {
  if (env.HOST_IP) return env.HOST_IP;
  for (const iface of ["en0", "en1"]) {
    try {
      const out = execFileSync("ipconfig", ["getifaddr", iface], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (out) return out;
    } catch {
      // interface absent/down — try the next one.
    }
  }
  return "127.0.0.1";
}

export function loadPersonas(path: string): PersonaConfig[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as PersonaConfig[];
  return raw;
}

export function joinUrl(hostIp: string, mobilePort: number, persona: BootedPersona): string {
  return `http://${hostIp}:${mobilePort}/?agent=http://${hostIp}:${persona.port}&app=${persona.app}&persona=${persona.key}`;
}

// --------------------------------------------------------------- CLI entry --

async function cliMain(): Promise<void> {
  const personasPath = process.env.ALPHA_PERSONAS_PATH ?? join(REPO_ROOT, "alpha", "personas.json");
  const stateDir = process.env.ALPHA_STATE_DIR ?? join(REPO_ROOT, "alpha", "state");
  const mobilePort = Number(process.env.ALPHA_MOBILE_PORT ?? 5173);
  const hostIp = detectHostIp();

  const personas = loadPersonas(personasPath);
  // eslint-disable-next-line no-console
  console.log(`[alpha_server] booting ${personas.length} persona(s) on host ${hostIp} (API_HOST=0.0.0.0)...`);

  const booted = await bootPersonas(personas, { hostIp, stateDir, apiHost: "0.0.0.0" });

  // eslint-disable-next-line no-console
  console.log("[alpha_server] ready:");
  for (const p of booted) {
    // eslint-disable-next-line no-console
    console.log(`  ${p.name.padEnd(10)} did=${p.did.slice(0, 24)}...  http://${hostIp}:${p.port}  join=${joinUrl(hostIp, mobilePort, p)}`);
  }

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    // eslint-disable-next-line no-console
    console.log(`\n[alpha_server] received ${signal}, closing ${booted.length} server(s)...`);
    void shutdownAll(booted).then(() => {
      // eslint-disable-next-line no-console
      console.log("[alpha_server] all servers + stores closed.");
      process.exit(0);
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  cliMain().catch((err: unknown) => {
    console.error("[alpha_server] fatal:", err);
    process.exitCode = 1;
  });
}
