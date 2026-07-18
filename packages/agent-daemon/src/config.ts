// Per-persona daemon configuration — env vars per docs/API.md's "Daemon config" table.
import { DEFAULT_MATCH_THRESHOLD } from "./matcher/matcher.js";

export interface EnvConfig {
  personaName: string;
  peerId: string;
  accent: string;
  agentPort: number;
  dbPath: string;
  trustedPeersPath?: string;
  fixturesPath?: string;
  ollamaUrl: string;
  chatModel: string;
  embedModel: string;
  statusDelayMs: number;
  matchThreshold: number;
  defaultAskTtlMs: number;
  transport: "matrix" | "mock" | "didcomm";
  matrixHomeserverUrl?: string;
  matrixAccessToken?: string;
  matrixRegistrationSecret?: string;
  /** did:peer:2 identity file (plaintext secrets — alpha; see docs/TRANSPORT.md). */
  didIdentityPath?: string;
  /** Host advertised in the DID's inbound service endpoint (http://<host>:<agentPort>/didcomm). */
  didcommHost: string;
}

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`Missing required env var ${key}`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): EnvConfig {
  const transport = env.TRANSPORT === "matrix" ? "matrix" : env.TRANSPORT === "didcomm" ? "didcomm" : "mock";
  return {
    personaName: requireEnv(env, "PERSONA_NAME"),
    peerId: requireEnv(env, "PEER_ID"),
    accent: env.ACCENT ?? "neutral",
    agentPort: Number(requireEnv(env, "AGENT_PORT")),
    dbPath: env.DB_PATH ?? ":memory:",
    trustedPeersPath: env.TRUSTED_PEERS_PATH,
    fixturesPath: env.FIXTURES_PATH,
    ollamaUrl: env.OLLAMA_URL ?? "http://localhost:11434",
    chatModel: env.CHAT_MODEL ?? "qwen3:4b",
    embedModel: env.EMBED_MODEL ?? "qwen3-embedding:8b",
    statusDelayMs: Number(env.STATUS_DELAY_MS ?? 30_000),
    matchThreshold: env.MATCH_THRESHOLD ? Number(env.MATCH_THRESHOLD) : DEFAULT_MATCH_THRESHOLD,
    defaultAskTtlMs: Number(env.DEFAULT_ASK_TTL_MS ?? 86_400_000),
    transport,
    matrixHomeserverUrl: env.MATRIX_HOMESERVER_URL,
    matrixAccessToken: env.MATRIX_ACCESS_TOKEN,
    matrixRegistrationSecret: env.MATRIX_REGISTRATION_SECRET,
    didIdentityPath: env.DID_IDENTITY_PATH,
    didcommHost: env.DIDCOMM_HOST ?? "127.0.0.1",
  };
}
