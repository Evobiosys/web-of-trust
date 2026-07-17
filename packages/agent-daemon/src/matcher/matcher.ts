// Matcher chain — §9. Graceful degradation, each stage falls through to the
// next when THAT STAGE is itself unavailable (network error/timeout/bad
// JSON after retry) — never merely because a stage's honest verdict was "no
// match" (a real "nothing crossed the embedding threshold" is a valid
// no-match, not a reason to force a keyword guess). This is a documented
// interpretation call (see docs/DAEMON.md) since the brief's three numbered
// stages don't spell out the exact fall-through trigger.
//
//   1. embedding shortlist (cosine >= threshold, cached per item)
//        -> network/timeout failure  => stage 3 (keyword), skip stage 2 entirely
//        -> empty shortlist          => "no_match" (stops here; no keyword retry)
//   2. LLM adjudication on the shortlist, strict JSON, temp 0
//        -> valid JSON               => trust the LLM's verdict
//        -> invalid JSON/timeout,
//           retried once             => "trust the shortlist" (top candidate, its cosine score)
//   3. keyword + de/en synonym fallback (only reached when stage 1 itself failed)
//
// Every candidate's score at every stage is appended to `scores` for I6
// (caller writes these into the audit log).
import type { Item } from "@resource-web/protocol";
import type { Store } from "../store/store.js";
import type { ChatClient, ChatMessage, EmbedClient } from "./clients.js";
import { cosineSimilarity } from "./cosine.js";
import { itemEmbeddingText } from "./embedding_text.js";
import { keywordMatch } from "./keyword_fallback.js";

export interface MatcherConfig {
  embedModel: string;
  chatModel: string;
  /** cosine similarity threshold for the embedding shortlist (default 0.60). */
  threshold: number;
}

export const DEFAULT_MATCH_THRESHOLD = 0.6;

export type MatchStage = "embedding_llm" | "embedding_shortlist" | "keyword" | "no_match";

export interface ScoreLogEntry {
  item_id: string;
  stage: MatchStage | "embedding_shortlist_candidate";
  score: number;
  detail: string;
}

export interface MatchResult {
  matched: boolean;
  item_id?: string;
  confidence: number;
  reason: string;
  stage: MatchStage;
  /** every stage's per-candidate scores, in the order they were computed — for I6 audit logging. */
  scores: ScoreLogEntry[];
}

export interface MatcherDeps {
  store: Store;
  embedClient: EmbedClient;
  chatClient: ChatClient;
  config: MatcherConfig;
}

export async function matchRequestToItems(queryText: string, items: Item[], deps: MatcherDeps): Promise<MatchResult> {
  const scores: ScoreLogEntry[] = [];
  const { store, embedClient, chatClient, config } = deps;

  if (items.length === 0) {
    return { matched: false, confidence: 0, reason: "no items to match against", stage: "no_match", scores };
  }

  const embedded = await tryEmbeddingShortlist(queryText, items, store, embedClient, config, scores);
  if (!embedded.available) {
    return matchByKeyword(queryText, items, scores);
  }

  if (embedded.shortlist.length === 0) {
    scores.push({ item_id: "-", stage: "no_match", score: 0, detail: "no item crossed the embedding threshold" });
    return {
      matched: false,
      confidence: 0,
      reason: "no item crossed the embedding threshold",
      stage: "no_match",
      scores,
    };
  }

  return adjudicateWithLlm(queryText, embedded.shortlist, chatClient, config, scores);
}

async function tryEmbeddingShortlist(
  queryText: string,
  items: Item[],
  store: Store,
  embedClient: EmbedClient,
  config: MatcherConfig,
  scores: ScoreLogEntry[]
): Promise<{ available: true; shortlist: Array<{ item: Item; score: number }> } | { available: false }> {
  try {
    const [queryVector] = await embedClient.embed(config.embedModel, [queryText]);
    if (!queryVector) throw new Error("ollama /api/embed returned no vector for the query");

    const itemVectors = await Promise.all(
      items.map(async (item) => {
        const cached = store.getItemEmbedding(item.id, config.embedModel);
        if (cached) return cached;
        const [vector] = await embedClient.embed(config.embedModel, [itemEmbeddingText(item)]);
        store.putItemEmbedding(item.id, config.embedModel, vector);
        return vector;
      })
    );

    const ranked = items
      .map((item, i) => ({ item, score: cosineSimilarity(queryVector, itemVectors[i]) }))
      .sort((a, b) => b.score - a.score);

    for (const { item, score } of ranked) {
      scores.push({ item_id: item.id, stage: "embedding_shortlist_candidate", score, detail: `cosine=${score.toFixed(4)}` });
    }

    return { available: true, shortlist: ranked.filter((s) => s.score >= config.threshold) };
  } catch (err) {
    scores.push({
      item_id: "-",
      stage: "embedding_shortlist_candidate",
      score: 0,
      detail: `embedding stage unavailable: ${(err as Error).message}`,
    });
    return { available: false };
  }
}

async function adjudicateWithLlm(
  queryText: string,
  shortlist: Array<{ item: Item; score: number }>,
  chatClient: ChatClient,
  config: MatcherConfig,
  scores: ScoreLogEntry[]
): Promise<MatchResult> {
  const top = shortlist[0];
  const prompt = buildAdjudicationPrompt(
    queryText,
    shortlist.map((s) => s.item)
  );

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await chatClient.chat(config.chatModel, prompt);
      const parsed = parseAdjudicationResponse(raw);
      scores.push({ item_id: parsed.item_id || "-", stage: "embedding_llm", score: parsed.confidence, detail: parsed.reason });
      return {
        matched: parsed.match,
        item_id: parsed.match ? parsed.item_id : undefined,
        confidence: parsed.confidence,
        reason: parsed.reason,
        stage: "embedding_llm",
        scores,
      };
    } catch (err) {
      scores.push({
        item_id: top.item.id,
        stage: "embedding_llm",
        score: 0,
        detail: `LLM adjudication attempt ${attempt} failed: ${(err as Error).message}`,
      });
    }
  }

  scores.push({
    item_id: top.item.id,
    stage: "embedding_shortlist",
    score: top.score,
    detail: "LLM unavailable after retry; trusting embedding shortlist top candidate",
  });
  return {
    matched: true,
    item_id: top.item.id,
    confidence: top.score,
    reason: "LLM adjudication unavailable after retry; trusted embedding shortlist top candidate",
    stage: "embedding_shortlist",
    scores,
  };
}

function matchByKeyword(queryText: string, items: Item[], scores: ScoreLogEntry[]): MatchResult {
  const results = keywordMatch(queryText, items);
  for (const r of results) {
    scores.push({ item_id: r.item_id, stage: "keyword", score: r.score, detail: `concepts=${r.matchedConcepts.join(",") || "(token overlap only)"}` });
  }
  if (results.length === 0) {
    scores.push({ item_id: "-", stage: "no_match", score: 0, detail: "no keyword/synonym overlap (no LLM available)" });
    return { matched: false, confidence: 0, reason: "no keyword/synonym overlap (no LLM available)", stage: "no_match", scores };
  }
  const top = results[0];
  return {
    matched: true,
    item_id: top.item_id,
    confidence: Math.min(1, top.score / 4),
    reason: `keyword/synonym match (no LLM available); concepts: ${top.matchedConcepts.join(", ") || "token overlap"}`,
    stage: "keyword",
    scores,
  };
}

interface AdjudicationResult {
  match: boolean;
  item_id: string;
  confidence: number;
  reason: string;
}

function buildAdjudicationPrompt(queryText: string, candidates: Item[]): ChatMessage[] {
  const candidateList = candidates
    .map((c) => `- id: ${c.id}\n  labels: ${c.labels.join(", ")}\n  description: ${c.description}`)
    .join("\n");
  return [
    {
      role: "system",
      content:
        'You adjudicate whether a resource request matches one of the candidate items. Respond with STRICT JSON only, no prose, matching exactly this shape: {"match": boolean, "item_id": string, "confidence": number, "reason": string}. "item_id" must be one of the candidate ids (or "" if match is false).',
    },
    {
      role: "user",
      content: `Request: "${queryText}"\n\nCandidates:\n${candidateList}\n\nWhich candidate (if any) satisfies the request?`,
    },
  ];
}

function parseAdjudicationResponse(raw: string): AdjudicationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`LLM adjudication response was not valid JSON: ${raw.slice(0, 200)}`);
  }
  const rec = parsed as Record<string, unknown>;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof rec.match !== "boolean" ||
    typeof rec.item_id !== "string" ||
    typeof rec.confidence !== "number" ||
    typeof rec.reason !== "string"
  ) {
    throw new Error(`LLM adjudication JSON missing required fields: ${raw.slice(0, 200)}`);
  }
  return parsed as AdjudicationResult;
}
