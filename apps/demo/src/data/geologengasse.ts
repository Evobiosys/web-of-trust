/**
 * Demo 20: the owner's own flat, his own web of trust.
 *
 * Runtime behaviour in this whole app is scenario-gated (mode.ts's
 * `wotScenario() === 'geologengasse'`), but THIS file's exports are still
 * statically imported by main.ts and therefore end up in EVERY demo's built
 * JS bundle, including demo 1/2/3/6's -- a runtime `if` cannot un-bundle a
 * string literal that was compiled in at build time. That distinction is
 * exactly why ADDRESS below is NOT a string literal.
 *
 * THE ADDRESS.
 *
 * Read from `import.meta.env.VITE_WOT_ADDRESS` (env.d.ts), a build-time env
 * var, NEVER a literal in any .ts file. Two things this buys, that a plain
 * constant could not:
 *
 *  1. Demo 1/2/3/6's build commands never set `VITE_WOT_ADDRESS` (see
 *     scripts/deploy_wot.sh) -- Vite inlines `import.meta.env.*` reads as a
 *     literal per build, so their bundles simply never contain the address
 *     at all, not even as unreachable dead code. Verified: `grep -rn
 *     "Geologengasse" dist/` against a demo-1 build must find nothing (see
 *     DEVLOG/result-report-demo20.md).
 *  2. The address is never committed to this repo at all -- this project's
 *     own CLAUDE.md says pushing this repo PUBLICLY is expected, so a
 *     literal here would eventually leak into git history regardless of
 *     what any later commit does. The owner supplies it as a shell env var
 *     at build time, on the machine doing the deploy, never written to a
 *     tracked file.
 *
 * What this does NOT solve, and must be said plainly rather than implied
 * away: demo 20's OWN built bundle still contains the address in cleartext,
 * because a fully client-side app has no other way to embed something it
 * answers with locally. If demo 20 is ever deployed somewhere fetchable by
 * the public internet, anyone with that URL can read the address out of the
 * JS. See the result report's "Decisions needed" section -- this is a
 * decision for the owner, not something to route around silently.
 */
export const ADDRESS =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_WOT_ADDRESS?.trim()) ||
  '(keine Adresse gesetzt: VITE_WOT_ADDRESS fehlt beim Build)'

/** The one fact the private calendar holds: free 26 Oct -- 1 Nov 2026,
 *  occupied otherwise. Local only -- never sent, never logged, matched
 *  against locally by `matchAccommodation()` below. */
export const FREE_FROM = '2026-10-26'
export const FREE_TO = '2026-11-01'

/** Coarse, human date range in the owner's own register -- no em dashes. */
export const FREE_WINDOW_DE = '26. Oktober bis 1. November 2026'
export const FREE_WINDOW_EN = '26 October to 1 November 2026'

// ---------------------------------------------------------------------------
// The graph seed: Jakob's real situation, not a fictional persona.
//
// These are DISPLAY-ONLY nodes for the bubble graph (main.ts's screenGraph).
// They are never `Peer` records and never route a live query anywhere --
// `packages/agent-daemon`'s hop-2 relay does not exist in this demo app at
// all (see docs/query-traversal.md section 1a: "The public demo has no trust
// graph at all"). Alex and Alex's friend are what the LAPTOP already knows
// about its own trust graph before any scan happens today; the real,
// queryable people this session creates are whoever Jakob accepts via the
// connect link (main.ts's acceptPendingRequest), held in
// DeviceState.peers -- several at once, never in this seed list.
// ---------------------------------------------------------------------------

// Jakob himself ("you") is not a member of this list -- he is the fixed
// centre main.ts's screenGraph() always draws separately.
export type GraphRing = 'ring1' | 'ring2'

export interface GraphNode {
  id: string
  label: { de: string; en: string }
  ring: GraphRing
  /** id of the node this one is connected via, or undefined for a direct
   *  (ring1) connection to Jakob. */
  via?: string
  /** True for the one placeholder bubble standing for someone not yet known. */
  placeholder?: boolean
}

export const SEED_GRAPH_NODES: GraphNode[] = [
  {
    id: 'alex',
    label: { de: 'Alex', en: 'Alex' },
    ring: 'ring1',
  },
  {
    id: 'alex-freund',
    // Deliberately a role description, not an invented name: this is a real
    // third person the owner knows only through Alex, and this app has no
    // business minting a name for someone it has never met.
    label: { de: 'Freund:in von Alex', en: "Alex's friend" },
    ring: 'ring2',
    via: 'alex',
  },
  {
    id: 'unknown',
    label: { de: '?', en: '?' },
    ring: 'ring1',
    placeholder: true,
  },
]
