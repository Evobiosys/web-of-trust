# @resource-web/network-access

Solo-useful first slice of the rebiosys resource-sharing dimension: the owner
offers **access to their network** ("who can you introduce me to?") behind the
full consent ladder, with LLM signal routing over a private contact inventory.

## The consent ladder

| Gate | Question | Policies |
|---|---|---|
| 0 | May this requester query at all? | `blocked` · `ask_each_time` (default, I9) · `standing_allow` |
| 1 | Run the matcher now, which model? | `manual` (owner picks small/large) · `auto_small` |
| 2 | Is the result shared, in what form? | `manual` · `auto_anonymized` |

Two invariants are enforced in `gates.ts`/`anonymity.ts` and covered by tests:

- **Identified reveals are never automatic.** No policy reaches the
  `reveal_identified` branch — only an explicit owner event with explicit
  contact ids does.
- **k-anonymity floor (k=7 default).** An aggregate ("7 of 100 people match")
  is only released at ≥k matches. Below k, the outward response is
  byte-identical to the zero-match response — as are declines, blocks, and
  expiries (extends invariant **I3**, Indistinguishable No). Requesters only
  ever see the output of `requesterView()`, the single sanitize chokepoint (I2).
  Per-peer **contracts** (`contracts.ts`) can adjust the floor for one
  requester — freely upward, or downward only with an explicit mutual
  agreement, never below k=2.

**Contract-review flag:** ADR-3 / retired WEB-3 forbids aggregate counts about
non-visible second-ring people. This aggregate is a different object — it
counts the owner's own first-ring contacts and is released only by the owner's
Gate-2 consent. Review before mounting into the daemon wire protocol.

## Run the solo demo

```
pnpm --filter @resource-web/network-access demo
# requester page  http://127.0.0.1:4790/
# owner inbox     http://127.0.0.1:4790/inbox
```

Matching uses Ollama when reachable (`OLLAMA_URL`, small `qwen3:4b`, large
`NETWORK_ACCESS_LARGE_MODEL`, default `qwen3.6-27b-iq4:latest`) and degrades to keyword
overlap with no LLM at all. Contacts come from `data/contacts.sample.json`
(fictional); point `NETWORK_ACCESS_CONTACTS` at a real inventory file once an
extraction pass has been approved. State persists to `data/demo_state.json`.

## Not yet (daemon-mount work)

- Store-and-forward while the device is offline (questhub relay / mediator) —
  the demo is one process, so "persist until laptop online" is simulated.
- Uniform reply scheduling (I3's 30 s no-jitter schedule) — manual gate timing
  currently leaks decision latency.
- Per-contact consent before an identified reveal (the noted-person ping, I8).
- SQLite store, audit log (I6), INTRO envelope integration.
