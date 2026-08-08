// Contact matching, mirroring the agent-daemon matcher philosophy: an LLM
// stage with strict-JSON output, and a keyword fallback so everything works
// with no LLM at all. Clients are injected interfaces — tests never touch the
// network (see contact_matcher.test.ts).
import type { ContactMatch, ContactRecord } from "./types.js";

export interface ContactMatcher {
  match(queryText: string, contacts: ContactRecord[]): Promise<ContactMatch[]>;
}

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface ChatClient {
  /** Returns the raw assistant message content (a JSON string, per the prompt contract below). */
  chat(model: string, messages: ChatMessage[]): Promise<string>;
}

/** Lowercase, strip diacritics/punctuation, collapse whitespace. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set([
  "a", "an", "the", "to", "in", "for", "who", "with", "and", "or", "of", "on",
  "someone", "somebody", "person", "people", "know", "knows", "can", "me",
  "intro", "introduce", "introduction", "looking",
]);

function tokenSet(text: string): Set<string> {
  return new Set(
    normalizeText(text)
      .split(" ")
      .filter((t) => t.length > 1 && !STOPWORDS.has(t)),
  );
}

export class KeywordContactMatcher implements ContactMatcher {
  constructor(private readonly minOverlap: number = 1) {}

  async match(queryText: string, contacts: ContactRecord[]): Promise<ContactMatch[]> {
    const queryTokens = tokenSet(queryText);
    const results: ContactMatch[] = [];
    for (const contact of contacts) {
      const haystack = tokenSet(
        [contact.name, contact.tags.join(" "), contact.notes].join(" "),
      );
      const overlap = [...queryTokens].filter((t) => haystack.has(t));
      if (overlap.length >= this.minOverlap) {
        results.push({
          contact_id: contact.id,
          score: overlap.length / Math.max(queryTokens.size, 1),
          reason: `keyword overlap: ${overlap.join(", ")}`,
        });
      }
    }
    return results.sort((a, b) => b.score - a.score);
  }
}

const LLM_SYSTEM_PROMPT = [
  "You match an introduction request against a private contact list.",
  'Answer ONLY with JSON: {"matches":[{"contact_id":"...","reason":"..."}]}.',
  "Include a contact only if they plausibly fit the request. Reasons stay under 12 words.",
].join(" ");

export class LlmContactMatcher implements ContactMatcher {
  constructor(
    private readonly chatClient: ChatClient,
    private readonly model: string,
    private readonly fallback: ContactMatcher,
  ) {}

  async match(queryText: string, contacts: ContactRecord[]): Promise<ContactMatch[]> {
    try {
      const listing = contacts
        .map((c) => `${c.id}: ${c.name} — tags: ${c.tags.join(", ")} — ${c.notes}`)
        .join("\n");
      const raw = await this.chatClient.chat(this.model, [
        { role: "system", content: LLM_SYSTEM_PROMPT },
        { role: "user", content: `Request: ${queryText}\n\nContacts:\n${listing}` },
      ]);
      const parsed = JSON.parse(extractJson(raw)) as { matches?: { contact_id?: string; reason?: string }[] };
      if (!Array.isArray(parsed.matches)) throw new Error("no matches array");
      const known = new Set(contacts.map((c) => c.id));
      return parsed.matches
        .filter((m): m is { contact_id: string; reason?: string } =>
          typeof m.contact_id === "string" && known.has(m.contact_id),
        )
        .map((m) => ({ contact_id: m.contact_id, score: 1, reason: m.reason ?? "LLM match" }));
    } catch {
      return this.fallback.match(queryText, contacts);
    }
  }
}

/** Tolerate models that wrap JSON in prose, code fences, or <think> blocks. */
function extractJson(raw: string): string {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in reply");
  return cleaned.slice(start, end + 1);
}

export class OllamaChatClient implements ChatClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number = 120_000,
  ) {}

  async chat(model: string, messages: ChatMessage[]): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, messages, stream: false }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`ollama chat failed: HTTP ${res.status}`);
      const data = (await res.json()) as { message?: { content?: string } };
      return data.message?.content ?? "";
    } finally {
      clearTimeout(timer);
    }
  }
}
