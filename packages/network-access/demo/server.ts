// Solo demo server: an owner inbox (the consent ladder, operated by hand) and
// a requester "ask" page. In-process only — no daemon, no relay. Run with
// `pnpm --filter @resource-web/network-access demo`, then open:
//   http://127.0.0.1:4790/        requester side (ask + poll status)
//   http://127.0.0.1:4790/inbox   owner side (gates 0/1/2)
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
import type { ContactRecord, GateEffect, IntroQuery, ModelSize, RequesterPolicy } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const config = loadConfig();
const contactsPath = process.env.NETWORK_ACCESS_CONTACTS ?? join(here, "..", "data", "contacts.sample.json");
const contacts = JSON.parse(readFileSync(contactsPath, "utf8")) as ContactRecord[];
const contactsById = new Map(contacts.map((c) => [c.id, c]));
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
        .match(query.text, contacts)
        .then((matches) => {
          const current = store.get(query.id);
          if (!current || current.state !== "running") return;
          const result = applyEvent(
            current,
            { type: "match_completed", matches, totalContacts: contacts.length },
            policy,
            { k: config.k, contactsById },
          );
          store.put(result.query);
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
  return {
    ...q,
    matches: q.matches?.map((m) => ({ ...m, name: contactsById.get(m.contact_id)?.name ?? m.contact_id })),
    kDecision: decision,
    policy: store.policyFor(q.requester),
  };
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
      const policy = store.policyFor(q.requester);
      const result = applyEvent(q, body.event, policy, { k: config.k, contactsById });
      store.put(result.query);
      runEffects(result.query, result.effects, policy);
      return json(res, 200, { state: result.query.state });
    }
    json(res, 404, { error: "not found" });
  } catch (err) {
    if (err instanceof GateError) return json(res, 409, { error: err.message });
    console.error(err);
    json(res, 500, { error: "internal error" });
  }
});

const port = Number(process.env.NETWORK_ACCESS_PORT ?? 4790);
server.listen(port, "127.0.0.1", () => {
  console.log("… network-access demo running …");
  console.log(`--------`);
  console.log(`requester page  http://127.0.0.1:${port}/`);
  console.log(`owner inbox     http://127.0.0.1:${port}/inbox`);
  console.log(`contacts: ${contacts.length} (${contactsPath})`);
  console.log(`models: small=${config.smallModel} large=${config.largeModel} via ${config.ollamaUrl} (keyword fallback if unreachable)`);
});
