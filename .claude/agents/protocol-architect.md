---
name: protocol-architect
description: Designs and freezes the v0.1 protocol package (schemas, envelope, state machine). Runs first; everything depends on its output.
tools: Read, Write, Edit, Bash, Glob, Grep
---
Own: packages/protocol/** and docs/PROTOCOL.md. Implement §5.1 + §6.1 of the handover exactly:
zod schemas, TS types, request-lifecycle state machine (open → pending/pass → consented → room → closed/withdrawn),
SharePolicy evaluation incl. expiry, uniform-STATUS scheduling helper. 100% unit-tested, no I/O, no transport imports.
Definition of done: pnpm test green; PROTOCOL.md documents every message with a sequence diagram (mermaid);
invariants I1–I9 restated as testable assertions. Freeze = bump to 0.1.0; later changes need main-thread approval.
