// Steward chat — POST /api/steward's brain. One entry point, `classifyAndRespond`,
// classifies intent (LLM strict JSON, rule-based fallback) and dispatches to
// capture (confirm-before-save), confirm, ask (asker lifecycle fan-out), or a
// generic reply.
import { randomUUID } from "node:crypto";
import { ItemSchema, type Item } from "@resource-web/protocol";
import type { Clock } from "../clock.js";
import type { Store } from "../store/store.js";
import type { AskRecord } from "../store/types.js";
import type { ChatClient } from "../matcher/clients.js";

export type StewardIntent = "ask" | "capture" | "confirm" | "other";

export interface StewardDeps {
  store: Store;
  clock: Clock;
  chatClient: ChatClient;
  chatModel: string;
  sendAsk: (text: string, opts?: { ttlMs?: number; lang?: string; area?: string }) => Promise<AskRecord>;
}

const CONFIRM_WORD = /^(yes|ja|jawohl|klar|passt|ok|okay)\b/i;
const ASK_MARKERS = ["hat wer", "who has", "gibt es", "?"];

/** Rule-based fallback, used when the LLM classifier is unreachable or returns malformed JSON. */
export function ruleBasedClassify(text: string): StewardIntent {
  const t = text.trim().toLowerCase();
  if (CONFIRM_WORD.test(t)) return "confirm";
  if (ASK_MARKERS.some((marker) => t.includes(marker))) return "ask";
  if (/\bich habe\b|\bi have\b|\bi've got\b/.test(t)) return "capture";
  return "other";
}

async function classifyIntent(text: string, deps: StewardDeps): Promise<StewardIntent> {
  try {
    const raw = await deps.chatClient.chat(deps.chatModel, [
      {
        role: "system",
        content:
          'Classify the user\'s message for a resource-sharing steward assistant. Respond with STRICT JSON only, no prose: {"kind": "ask" | "capture" | "confirm" | "other"}. "ask" = asking whether anyone in their trusted network has or can lend something. "capture" = describing an item they own that they could share. "confirm" = a short affirmative reply (yes/ja/ok) confirming a previous proposal. "other" = anything else.',
      },
      { role: "user", content: text },
    ]);
    const parsed = JSON.parse(raw) as { kind?: unknown };
    if (parsed && (parsed.kind === "ask" || parsed.kind === "capture" || parsed.kind === "confirm" || parsed.kind === "other")) {
      return parsed.kind;
    }
    throw new Error(`classify response missing valid "kind": ${raw.slice(0, 200)}`);
  } catch {
    return ruleBasedClassify(text);
  }
}

interface CaptureProposal {
  labels: string[];
  description: string;
  tags: string[];
}

async function extractCaptureProposal(text: string, deps: StewardDeps): Promise<CaptureProposal> {
  try {
    const raw = await deps.chatClient.chat(deps.chatModel, [
      {
        role: "system",
        content:
          'Extract a shareable item from the user\'s message about something they own. Respond with STRICT JSON only: {"labels": string[], "description": string, "tags": string[]}. "labels" should include the item name as the user wrote it, plus an English translation if the original wasn\'t English. "description" is one short sentence. "tags" are lowercase single-word categories.',
      },
      { role: "user", content: text },
    ]);
    const parsed = JSON.parse(raw) as Partial<CaptureProposal>;
    if (Array.isArray(parsed.labels) && parsed.labels.length > 0 && typeof parsed.description === "string" && Array.isArray(parsed.tags)) {
      return { labels: parsed.labels, description: parsed.description, tags: parsed.tags };
    }
    throw new Error(`capture extraction response missing required fields: ${raw.slice(0, 200)}`);
  } catch {
    return { labels: [text], description: text, tags: [] };
  }
}

async function handleCapture(text: string, deps: StewardDeps): Promise<string> {
  const proposal = await extractCaptureProposal(text, deps);
  deps.store.putPendingCapture({
    proposal_id: randomUUID(),
    item: { labels: proposal.labels, description: proposal.description, tags: proposal.tags, provenance: { kind: "self" }, policy: ItemSchema.shape.policy.parse({}) },
    created_at: deps.clock.now().toISOString(),
  });
  return `I can add this to your shelf: "${proposal.labels.join(" / ")}" — ${proposal.description} (tags: ${proposal.tags.join(", ") || "none"}). Shared with trusted contacts, ask-each-time by default. Reply "yes" to confirm.`;
}

function handleConfirm(deps: StewardDeps): string {
  const pending = deps.store.getLatestPendingCapture();
  if (!pending) {
    return "There's nothing to confirm right now — tell me about an item first.";
  }
  const item: Item = ItemSchema.parse({ id: randomUUID(), ...pending.item });
  deps.store.putItem(item);
  deps.store.clearPendingCapture(pending.proposal_id);
  return `Added "${item.labels[0]}" to your shelf.`;
}

async function handleAsk(text: string, deps: StewardDeps): Promise<string> {
  const ask = await deps.sendAsk(text);
  return `Asked ${ask.queried_count} trusted people nearby. You'll hear back.`;
}

function handleOther(): string {
  return "I'm not sure what you'd like to do — tell me about something you have to share, or ask if someone nearby has what you need.";
}

export async function classifyAndRespond(text: string, deps: StewardDeps): Promise<string> {
  const intent = await classifyIntent(text, deps);
  switch (intent) {
    case "capture":
      return handleCapture(text, deps);
    case "confirm":
      return handleConfirm(deps);
    case "ask":
      return handleAsk(text, deps);
    case "other":
      return handleOther();
  }
}
