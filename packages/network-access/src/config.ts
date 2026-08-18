// Model-size mapping for Gate 1. Small keeps the machine usable while a query
// runs (the owner default); large takes the box for better recall.
export interface NetworkAccessConfig {
  ollamaUrl: string;
  smallModel: string;
  largeModel: string;
  k: number;
  /** Uniform reply-scheduling tick, ms (D19/D20 known-debt, Delta 3). */
  replyTickMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): NetworkAccessConfig {
  return {
    ollamaUrl: env.OLLAMA_URL ?? "http://127.0.0.1:11434",
    smallModel: env.NETWORK_ACCESS_SMALL_MODEL ?? "qwen3:4b",
    largeModel: env.NETWORK_ACCESS_LARGE_MODEL ?? "qwen3.6-27b-iq4:latest",
    k: env.NETWORK_ACCESS_K ? Number(env.NETWORK_ACCESS_K) : 3,
    replyTickMs: env.NETWORK_ACCESS_REPLY_TICK_MS ? Number(env.NETWORK_ACCESS_REPLY_TICK_MS) : 30_000,
  };
}
