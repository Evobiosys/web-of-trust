// Ollama HTTP clients — matcher chain stages 1 (embed) and 2 (chat).
// Both are injected interfaces so matcher.ts and its tests never call the
// network directly: production wiring (main.ts) uses the Ollama* classes
// below; tests use fakes (see matcher.test.ts) driven from recorded fixtures.
export interface EmbedClient {
  embed(model: string, input: string[]): Promise<number[][]>;
}

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface ChatClient {
  /** Returns the raw assistant message content (a JSON string, per matcher.ts's prompt contract). */
  chat(model: string, messages: ChatMessage[]): Promise<string>;
}

interface OllamaHttpOptions {
  baseUrl: string;
  timeoutMs?: number;
}

async function postJson<T>(url: string, body: unknown, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`ollama request to ${url} failed: HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export class OllamaEmbedClient implements EmbedClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: OllamaHttpOptions) {
    this.baseUrl = opts.baseUrl;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  async embed(model: string, input: string[]): Promise<number[][]> {
    const data = await postJson<{ embeddings: number[][] }>(
      `${this.baseUrl}/api/embed`,
      { model, input },
      this.timeoutMs
    );
    return data.embeddings;
  }
}

export class OllamaChatClient implements ChatClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: OllamaHttpOptions) {
    this.baseUrl = opts.baseUrl;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  async chat(model: string, messages: ChatMessage[]): Promise<string> {
    const data = await postJson<{ message: { content: string } }>(
      `${this.baseUrl}/api/chat`,
      { model, messages, options: { temperature: 0 }, format: "json", stream: false },
      this.timeoutMs
    );
    return data.message.content;
  }
}
