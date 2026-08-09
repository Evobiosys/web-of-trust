// Solo demo server: an owner inbox (the consent ladder, operated by hand) and
// a requester "ask" page. In-process only — no daemon, no relay. Run with
// `pnpm --filter @resource-web/network-access demo`, then open:
//   http://127.0.0.1:4790/        requester side (ask + poll status)
//   http://127.0.0.1:4790/inbox   owner side (gates 0/1/2)
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  applyEvent,
  GateError,
  receiveQuery,
  requesterView,
  anonymizedRevealDecision,
  KeywordContactMatcher,
  LlmContactMatcher,
  OllamaChatClient,
  QueryStore,
  loadConfig,
} from "../src/index.js";
import type {
  ContactRecord,
  GateEffect,
  IntroQuery,
  ModelSize,
  OwnerProfile,
  RequesterPolicy,
  RevealDecision,
} from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const config = loadConfig();
const contactsPath = process.env.NETWORK_ACCESS_CONTACTS ?? join(here, "..", "data", "contacts.sample.json");
const contacts = JSON.parse(readFileSync(contactsPath, "utf8")) as ContactRecord[];

// Inventory records (JSONL, Graffiti-style supersession: latest record wins)
// become matchable entries alongside contacts — the network shares things AND people.
const inventoryPath =
  process.env.NETWORK_ACCESS_INVENTORY ?? join(homedir(), ".local", "share", "rebiosys", "inventory.jsonl");
function loadInventory(): ContactRecord[] {
  if (!existsSync(inventoryPath)) return [];
  const byId = new Map<string, any>();
  const superseded = new Set<string>();
  for (const line of readFileSync(inventoryPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line);
    byId.set(rec.id, rec);
    if (rec.supersedes) superseded.add(rec.supersedes);
  }
  return [...byId.values()]
    .filter((r) => !superseded.has(r.id) && r.status !== "retired" && r.status !== "gone")
    .map((r) => ({
      id: r.id,
      name: r.name,
      tags: [...(r.tags ?? []), r.category ?? ""],
      notes: [r.description ?? "", r.availability_note ?? "", r.location ?? ""].join(" "),
    }));
}
const inventory = loadInventory();
const corpus: ContactRecord[] = [...contacts, ...inventory];
const contactsById = new Map(corpus.map((c) => [c.id, c]));

const profilesPath = join(here, "..", "data", "profiles.json");
const profiles: OwnerProfile[] = existsSync(profilesPath)
  ? JSON.parse(readFileSync(profilesPath, "utf8"))
  : [{ id: "general", name: "Owner", contact: "connect@evobiosys.org" }];
const defaultProfile = profiles[0]!;

const store = new QueryStore(join(here, "..", "data", "demo_state.json"));

const keyword = new KeywordContactMatcher();
function matcherFor(model: ModelSize) {
  const name = model === "small" ? config.smallModel : config.largeModel;
  return new LlmContactMatcher(new OllamaChatClient(config.ollamaUrl), name, keyword);
}

function runEffects(query: IntroQuery, effects: GateEffect[], policy: RequesterPolicy): void {
  for (const effect of effects) {
    if (effect.type === "start_match") {
      void matcherFor(effect.model)
        .match(query.text, corpus)
        .then((matches) => {
          const current = store.get(query.id);
          if (!current || current.state !== "running") return;
          const result = applyEvent(
            current,
            { type: "match_completed", matches, totalContacts: corpus.length },
            policy,
            { k: config.k, contactsById, defaultProfile },
          );
          store.put(result.query);
          pushResponses();
        })
        .catch((err) => console.error(`match run failed for ${query.id}:`, err));
    }
    // "respond" effects need no I/O here: the response is stored on the query
    // and the requester page polls requesterView().
  }
}

function ownerView(q: IntroQuery) {
  const decision =
    q.matches !== undefined
      ? anonymizedRevealDecision(q.matches.length, q.totalContacts ?? 0, config.k)
      : undefined;
  const relayEntry = Object.values(loadRelayMap()).find((e) => e.localId === q.id);
  return {
    ...q,
    matches: q.matches?.map((m) => ({ ...m, name: contactsById.get(m.contact_id)?.name ?? m.contact_id })),
    kDecision: decision,
    policy: store.policyFor(q.requester),
    emailVerified: relayEntry?.emailVerified ?? null,
    viaRelay: relayEntry !== undefined,
    // Transparent trace: what the algorithm did / would send, spelled out.
    trace:
      q.matches !== undefined
        ? {
            scanned: q.totalContacts ?? corpus.length,
            corpusSplit: { contacts: contacts.length, inventory: inventory.length },
            matchEvidence: q.matches.map((m) => ({ id: m.contact_id, score: m.score, reason: m.reason })),
            kDecision: decision,
            outwardIfAnonymized: decision ? requesterPreview(decision) : undefined,
            outwardSent: q.response?.text,
          }
        : undefined,
  };
}

function requesterPreview(decision: RevealDecision): string {
  return decision.kind === "anonymized"
    ? `${decision.matchCount} of ${decision.totalCount} people in this network are sharing what you asked about.`
    : "No shareable result for this request.";
}

function json(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: import("node:http").IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

// ---------------------------------------------------------------------------
// Relay bridge: laptop-first inversion. rebiosys-pull fetches persisted
// queries off the questhub relay (over the existing SSH master, LuLu-proof);
// each becomes a local query walking the same consent ladder; finished
// responses are pushed back so the requester's /status link answers.
const relayMapPath = join(here, "..", "data", "relay_map.json");
const inboxPath = join(homedir(), ".local", "share", "rebiosys", "inbox.jsonl");

interface RelayMapEntry {
  localId: string;
  pushed: boolean;
  emailVerified?: boolean;
}
function loadRelayMap(): Record<string, RelayMapEntry> {
  return existsSync(relayMapPath) ? JSON.parse(readFileSync(relayMapPath, "utf8")) : {};
}
function saveRelayMap(map: Record<string, RelayMapEntry>): void {
  writeFileSync(relayMapPath, JSON.stringify(map, null, 2));
}

function relayToken(): string {
  return execFileSync("security", ["find-generic-password", "-s", "rebiosys-pull", "-a", "questhub", "-w"], {
    encoding: "utf8",
  }).trim();
}

function bridgeCycle(): { ingested: number; pushed: number } {
  let ingested = 0;
  try {
    execFileSync(join(homedir(), ".local", "bin", "rebiosys-pull"), [], {
      encoding: "utf8",
      cwd: homedir(),
      env: { ...process.env, PYTHONPATH: "" },
      timeout: 60_000,
    });
  } catch (err) {
    console.error("relay pull failed:", (err as Error).message.slice(0, 200));
  }
  const map = loadRelayMap();
  if (existsSync(inboxPath)) {
    for (const line of readFileSync(inboxPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const rec = JSON.parse(line);
      if (rec.kind !== "query" || map[rec.id]) continue;
      const requester = rec.email || rec.name || "unknown";
      const policy = store.policyFor(requester);
      const result = receiveQuery(
        { id: randomUUID(), requester, text: rec.text, receivedAt: Date.now() },
        policy,
      );
      store.put(result.query);
      runEffects(result.query, result.effects, policy);
      map[rec.id] = { localId: result.query.id, pushed: false, emailVerified: !!rec.email_verified };
      ingested++;
    }
  }
  saveRelayMap(map);
  const pushed = pushResponses();
  return { ingested, pushed };
}

function pushResponses(): number {
  let pushed = 0;
  const map = loadRelayMap();
  for (const [relayId, entry] of Object.entries(map)) {
    if (entry.pushed) continue;
    const q = store.get(entry.localId);
    if (!q?.response) continue;
    const payload = JSON.stringify({ token: relayToken(), id: relayId, response: requesterView(q) });
    try {
      execFileSync(
        "ssh",
        ["questhub", `curl -s -X POST http://127.0.0.1:8095/respond -H 'content-type: application/json' -d '${payload.replace(/'/g, "'\\''")}'`],
        { encoding: "utf8", timeout: 30_000 },
      );
      entry.pushed = true;
      pushed++;
    } catch (err) {
      console.error(`response push failed for ${relayId}:`, (err as Error).message.slice(0, 200));
    }
  }
  saveRelayMap(map);
  return pushed;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  try {
    if (req.method === "GET" && (path === "/" || path === "/ask")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(readFileSync(join(here, "ask.html")));
      return;
    }
    if (req.method === "GET" && path === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === "GET" && path === "/inbox") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(readFileSync(join(here, "inbox.html")));
      return;
    }
    if (req.method === "POST" && path === "/api/ask") {
      const body = await readBody(req);
      const requester = String(body.requester ?? "").trim();
      const text = String(body.text ?? "").trim();
      if (!requester || !text) return json(res, 400, { error: "requester and text required" });
      const policy = store.policyFor(requester);
      const result = receiveQuery(
        { id: randomUUID(), requester, text, receivedAt: Date.now() },
        policy,
      );
      store.put(result.query);
      runEffects(result.query, result.effects, policy);
      return json(res, 200, { id: result.query.id });
    }
    if (req.method === "GET" && path.startsWith("/api/ask/")) {
      const q = store.get(path.slice("/api/ask/".length));
      if (!q) return json(res, 404, { error: "unknown query" });
      return json(res, 200, requesterView(q));
    }
    if (req.method === "GET" && path === "/api/inbox") {
      return json(res, 200, {
        queries: store.list().map(ownerView),
        policies: store.listPolicies(),
        contacts: contacts.length,
        k: config.k,
      });
    }
    if (req.method === "POST" && path === "/api/policies") {
      const body = await readBody(req);
      store.setPolicy(String(body.requester), body.policy as RequesterPolicy);
      return json(res, 200, { ok: true });
    }
    const eventMatch = path.match(/^\/api\/queries\/([^/]+)\/event$/);
    if (req.method === "POST" && eventMatch) {
      const q = store.get(eventMatch[1]!);
      if (!q) return json(res, 404, { error: "unknown query" });
      const body = await readBody(req);
      let event = body.event;
      if (event?.type === "reveal_identity" && !event.profile) {
        const profile = profiles.find((p) => p.id === (event.profileId ?? "general")) ?? defaultProfile;
        event = { type: "reveal_identity", profile };
      }
      const policy = store.policyFor(q.requester);
      const result = applyEvent(q, event, policy, { k: config.k, contactsById, defaultProfile });
      store.put(result.query);
      runEffects(result.query, result.effects, policy);
      pushResponses();
      return json(res, 200, { state: result.query.state });
    }
    if (req.method === "POST" && path === "/api/relay/bridge") {
      const report = bridgeCycle();
      return json(res, 200, report);
    }
    json(res, 404, { error: "not found" });
  } catch (err) {
    if (err instanceof GateError) return json(res, 409, { error: err.message });
    console.error(err);
    json(res, 500, { error: "internal error" });
  }
});

const port = Number(process.env.NETWORK_ACCESS_PORT ?? 4790);
if (process.env.NETWORK_ACCESS_NO_BRIDGE !== "1") {
  setTimeout(() => {
    const r = bridgeCycle();
    console.log(`relay bridge: ingested ${r.ingested}, pushed ${r.pushed}`);
  }, 2_000);
  setInterval(() => bridgeCycle(), 60_000);
}
server.listen(port, "127.0.0.1", () => {
  console.log("… network-access demo running …");
  console.log(`--------`);
  console.log(`requester page  http://127.0.0.1:${port}/`);
  console.log(`owner inbox     http://127.0.0.1:${port}/inbox`);
  console.log(`contacts: ${contacts.length} (${contactsPath})`);
  console.log(`models: small=${config.smallModel} large=${config.largeModel} via ${config.ollamaUrl} (keyword fallback if unreachable)`);
});
