// Minimal SQL driver seam behind which better-sqlite3 (preferred) or
// node:sqlite (D6 fallback, node >=22 built-in) can sit interchangeably.
// SqliteStore (sqlite_store.ts) is written entirely against this interface,
// so the fallback decision is made once, here, and nowhere else.
//
// This package is ESM ("type": "module" / NodeNext); `createRequire` gives us
// a synchronous, catchable `require` for the two CJS native/built-in modules
// so the D6 try/catch fallback can stay synchronous.
import { createRequire } from "node:module";

const requireCjs = createRequire(import.meta.url);

export interface SqlDriver {
  exec(sql: string): void;
  run(sql: string, params?: unknown[]): void;
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | undefined;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
  close(): void;
}

function createBetterSqliteDriver(path: string): SqlDriver {
  const Database = requireCjs("better-sqlite3") as typeof import("better-sqlite3");
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  return {
    exec: (sql) => {
      db.exec(sql);
    },
    run: (sql, params = []) => {
      db.prepare(sql).run(...params);
    },
    get: (sql, params = []) => db.prepare(sql).get(...params) as never,
    all: (sql, params = []) => db.prepare(sql).all(...params) as never,
    close: () => db.close(),
  };
}

function createNodeSqliteDriver(path: string): SqlDriver {
  // node:sqlite (D6 fallback) — built-in since Node 22, stable enough for our
  // synchronous, single-process use. Dynamic require so environments where
  // it's absent don't fail to even load this module.
  const { DatabaseSync } = requireCjs("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(path);
  return {
    exec: (sql) => {
      db.exec(sql);
    },
    run: (sql, params = []) => {
      db.prepare(sql).run(...(params as never[]));
    },
    get: (sql, params = []) => db.prepare(sql).get(...(params as never[])) as never,
    all: (sql, params = []) => db.prepare(sql).all(...(params as never[])) as never,
    close: () => db.close(),
  };
}

/**
 * D6: try better-sqlite3 first (native prebuild); if it isn't installed or
 * fails to load/compile on this Node version, fall back to node:sqlite.
 * Both are exercised through the exact same SqlDriver surface.
 */
export function createSqlDriver(path: string): SqlDriver {
  try {
    return createBetterSqliteDriver(path);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[agent-daemon/store] better-sqlite3 unavailable (${(err as Error).message}); falling back to node:sqlite (DECISIONS.md D6)`
    );
    return createNodeSqliteDriver(path);
  }
}
