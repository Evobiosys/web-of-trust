// Offline EmbedClient backed by the recording in test-fixtures/embeddings.json
// (produced once by scripts/record_embeddings.ts against real ollama). Matcher
// unit tests use this instead of the network — deterministic, no ollama
// dependency at test time (brief §9: "matcher unit tests run offline from the
// recording").
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { EmbedClient } from "./clients.js";

interface FixtureFile {
  model: string;
  recorded_at: string;
  vectors: Record<string, number[]>;
}

export function loadEmbeddingFixture(): FixtureFile {
  const fixturePath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "test-fixtures",
    "embeddings.json"
  );
  return JSON.parse(readFileSync(fixturePath, "utf8")) as FixtureFile;
}

export class FixtureEmbedClient implements EmbedClient {
  private readonly fixture: FixtureFile;

  constructor(fixture: FixtureFile = loadEmbeddingFixture()) {
    this.fixture = fixture;
  }

  get model(): string {
    return this.fixture.model;
  }

  async embed(model: string, input: string[]): Promise<number[][]> {
    if (model !== this.fixture.model) {
      throw new Error(`FixtureEmbedClient: recording is for model '${this.fixture.model}', got '${model}'`);
    }
    return input.map((text) => {
      const vector = this.fixture.vectors[text];
      if (!vector) {
        throw new Error(
          `FixtureEmbedClient: no recorded vector for "${text.slice(0, 80)}" — re-run scripts/record_embeddings.ts after adding new fixture texts`
        );
      }
      return vector;
    });
  }
}
