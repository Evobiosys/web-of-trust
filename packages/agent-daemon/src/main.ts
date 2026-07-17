#!/usr/bin/env node
// Boot entry point for one persona's agent-daemon process. Reads env config
// (docs/API.md's table), wires the transport factory (TRANSPORT=mock|matrix
// — the ONLY place @resource-web/transport may be imported, per the brief),
// loads trusted_peers.json + optional fixtures, and starts the REST/WS server.
import { readFileSync, existsSync } from "node:fs";
import { TrustEdgeSchema, ItemSchema, type TransportAdapter } from "@resource-web/protocol";
import { loadConfig } from "./config.js";
import { SqliteStore } from "./store/sqlite_store.js";
import { SystemClock, RealScheduler } from "./clock.js";
import { InMemoryBus, InMemoryTransport } from "./transport/in_memory_transport.js";
import { OllamaChatClient, OllamaEmbedClient } from "./matcher/clients.js";
import { Daemon, type DaemonConfig } from "./daemon/daemon.js";
import { startServer } from "./api/server.js";

/**
 * Transport factory (brief §"Transport"): TRANSPORT=mock -> our own
 * InMemoryTransport (I5's swap-seam proof; also what tests/headless_demo use
 * directly). TRANSPORT=matrix -> @resource-web/transport's MatrixTransport —
 * import ONLY happens here. As of this worktree, @resource-web/transport is
 * still a stub (`export const PACKAGE = "transport"`, no MatrixTransport
 * export yet — a sibling worktree owns it), so the matrix arm cannot resolve
 * a real class yet. Rather than guess at its shape, this throws a clear,
 * actionable error; integration happens at merge (see docs/DAEMON.md).
 */
function createTransport(transport: "mock" | "matrix"): TransportAdapter {
  if (transport === "mock") {
    return new InMemoryTransport(new InMemoryBus());
  }
  // TODO(merge): import { MatrixTransport } from "@resource-web/transport" once
  // that package exports it, and construct it here with the MATRIX_* env vars.
  throw new Error(
    "TRANSPORT=matrix is not yet wired: @resource-web/transport does not export a MatrixTransport in this worktree. " +
      "Use TRANSPORT=mock until the transport package lands (see docs/DAEMON.md, 'Transport factory')."
  );
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const store = new SqliteStore(cfg.dbPath);

  if (cfg.trustedPeersPath && existsSync(cfg.trustedPeersPath)) {
    const raw = JSON.parse(readFileSync(cfg.trustedPeersPath, "utf8")) as unknown[];
    for (const entry of raw) {
      const edge = TrustEdgeSchema.parse(entry);
      if (!store.getTrustEdge(edge.peer)) store.putTrustEdge(edge);
    }
  }
  if (cfg.fixturesPath && existsSync(cfg.fixturesPath)) {
    const raw = JSON.parse(readFileSync(cfg.fixturesPath, "utf8")) as unknown[];
    for (const entry of raw) {
      const item = ItemSchema.parse(entry);
      if (!store.getItem(item.id)) store.putItem(item);
    }
  }

  const daemonConfig: DaemonConfig = {
    personaName: cfg.personaName,
    peerId: cfg.peerId,
    accent: cfg.accent,
    statusDelayMs: cfg.statusDelayMs,
    defaultAskTtlMs: cfg.defaultAskTtlMs,
    matcher: { embedModel: cfg.embedModel, chatModel: cfg.chatModel, threshold: cfg.matchThreshold },
  };

  const clock = new SystemClock();
  const daemon = new Daemon({
    config: daemonConfig,
    store,
    transport: createTransport(cfg.transport),
    scheduler: new RealScheduler(clock),
    clock,
    embedClient: new OllamaEmbedClient({ baseUrl: cfg.ollamaUrl }),
    chatClient: new OllamaChatClient({ baseUrl: cfg.ollamaUrl }),
  });

  await daemon.init();
  const server = await startServer(daemon, cfg.agentPort);
  // eslint-disable-next-line no-console
  console.log(`[agent-daemon] ${cfg.personaName} listening on http://127.0.0.1:${server.port} (transport=${cfg.transport})`);

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void server.close().then(() => {
        store.close();
        process.exit(0);
      });
    });
  }
}

main().catch((err: unknown) => {
  console.error("[agent-daemon] fatal:", err);
  process.exitCode = 1;
});
