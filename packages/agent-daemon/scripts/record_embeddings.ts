#!/usr/bin/env tsx
// Records real ollama embeddings once into test-fixtures/embeddings.json, so
// matcher unit tests run offline/deterministically against a frozen
// recording instead of hitting the network every run (brief §9). Re-run this
// script by hand whenever the fixed query/item text set below changes.
//
// Usage: pnpm --filter @resource-web/agent-daemon exec tsx scripts/record_embeddings.ts
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { OllamaEmbedClient } from "../src/matcher/clients.js";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const EMBED_MODEL = process.env.EMBED_MODEL ?? "qwen3-embedding:8b";

// Item texts use the same join rule as itemEmbeddingText() (labels + ". " + description).
const TEXTS = [
  // demo items (Ben)
  "Bosch IXO cordless screwdriver. Akkuschrauber. Small cordless screwdriver, barely used.",
  "2p camping tent. Zelt. Two-person tent, waterproof, easy setup.",
  "3m ladder. Leiter. Aluminium 3-metre ladder.",
  // demo item (Anna)
  "Bicycle pump. Luftpumpe. Foot pump, fits Schrader and Presta valves.",
  // queries used across matcher tests + headless demo
  "Hat wer in meiner Nähe einen Akkuschrauber?",
  "Hat wer ein Stand-Up-Paddle?",
  "Does anyone have a ladder I could borrow?",
];

async function main() {
  const client = new OllamaEmbedClient({ baseUrl: OLLAMA_URL, timeoutMs: 30_000 });
  const vectors: Record<string, number[]> = {};
  console.log(`Recording embeddings from ${OLLAMA_URL} (model ${EMBED_MODEL}) for ${TEXTS.length} texts...`);
  for (const text of TEXTS) {
    const [vector] = await client.embed(EMBED_MODEL, [text]);
    vectors[text] = vector;
    console.log(`  ok (${vector.length} dims): ${text.slice(0, 60)}${text.length > 60 ? "…" : ""}`);
  }
  const out = { model: EMBED_MODEL, recorded_at: new Date().toISOString(), vectors };
  const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "test-fixtures", "embeddings.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error("record_embeddings failed:", err);
  console.error(
    "If ollama is unreachable, matcher tests fall back to keyword-only coverage — note this in the M2-A report per the brief."
  );
  process.exitCode = 1;
});
