// Model-size mapping for Gate 1. Small keeps the machine usable while a query
// runs (the owner default); large takes the box for better recall.
export interface NetworkAccessConfig {
  ollamaUrl: string;
  smallModel: string;
  largeModel: string;
  /** Strongest local model for vault (local-files) queries — memo item 4:
   * "matching via the strongest local model configured." Defaults to
   * `mistral-small:24b` per Jakob's own naming (confirmed present via
   * `ollama list` at build time); an owner without that model pulled can
   * override to reuse largeModel. LlmVaultMatcher falls back to the
   * deterministic keyword matcher on any failure regardless (unreachable
   * ollama, missing model, malformed reply) — this default never blocks
   * offline tests, which inject a fake ChatClient instead of touching it. */
  vaultModel: string;
  /** Whether the demo's vault matcher actually calls the LLM, or goes
   * straight to the deterministic keyword matcher. Defaults to false: a
   * live walkthrough (Friday demo) needs fast, repeatable results, and a
   * ~24B local model adds several seconds of latency per query plus more
   * conservative recall than the keyword overlap the fixtures are tuned
   * against (observed live: 1-2 of 4 plausible notes vs. keyword's 4/4 — see
   * DECISIONS.md D22). Set NETWORK_ACCESS_VAULT_USE_LLM=1 to show the real
   * "strongest local model configured" path instead. */
  vaultUseLlm: boolean;
  /** Local-files query target: a markdown folder (Obsidian-style vault).
   * No default here — resolving a repo-relative default from inside `src`
   * would break once `tsc` emits to `dist/` at a different depth (see
   * demo/server.ts, which resolves it relative to `import.meta.url` at the
   * host level, same as contactsPath/inventoryPath already do). */
  k: number;
  /** Uniform reply-scheduling tick, ms (D19/D20 known-debt, Delta 3). */
  replyTickMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): NetworkAccessConfig {
  return {
    ollamaUrl: env.OLLAMA_URL ?? "http://127.0.0.1:11434",
    smallModel: env.NETWORK_ACCESS_SMALL_MODEL ?? "qwen3:4b",
    largeModel: env.NETWORK_ACCESS_LARGE_MODEL ?? "qwen3.6-27b-iq4:latest",
    vaultModel: env.NETWORK_ACCESS_VAULT_MODEL ?? "mistral-small:24b",
    vaultUseLlm: env.NETWORK_ACCESS_VAULT_USE_LLM === "1",
    k: env.NETWORK_ACCESS_K ? Number(env.NETWORK_ACCESS_K) : 3,
    replyTickMs: env.NETWORK_ACCESS_REPLY_TICK_MS ? Number(env.NETWORK_ACCESS_REPLY_TICK_MS) : 30_000,
  };
}
