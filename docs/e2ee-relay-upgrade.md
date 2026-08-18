# E2EE relay upgrade — deployment guide (laptop side SHIPPED, relay side PENDING)

Status 2026-08-18: everything the laptop and the browser need is built and tested
in this repo (`packages/relay-crypto`, `scripts/rebiosys-pull-e2ee`). Nothing has
been deployed to questhub, no key exists in the keychain yet, and the live
`~/.local/bin/rebiosys-pull` is untouched. The landing page must keep saying
"end-to-end encryption in progress" until the steps below are done.

## What is built (this repo)

- `packages/relay-crypto/src/sealed_box.ts` — sealed box over WebCrypto only
  (identical code path in browser and Node ≥ 20): per-message ephemeral P-256
  keypair → ECDH → HKDF-SHA-256 (fixed info string, see `HKDF_INFO`) →
  AES-256-GCM. Envelope: `{v: 1, alg: "ECDH-ES+A256GCM", epk: <ephemeral public
  JWK>, iv, ct}` (iv/ct base64). `generateKeyPair()`, `seal(publicJwk, bytes)`,
  `unseal(pkcs8OrKey, envelope)`, `importPrivateKey(...)`.
- `packages/relay-crypto/static/seal.js` — dependency-free browser script for the
  landing form: `sealForLaptop(publicJwk, obj)` → envelope; the form POSTs
  `{ciphertext_envelope}` instead of plaintext fields.
- `packages/relay-crypto/src/cli_unseal.ts` — tiny Node CLI (envelope on stdin,
  key via env/arg → plaintext on stdout); this is what Python shells out to.
- `packages/relay-crypto/scripts/keygen.ts` — generates the laptop keypair,
  prints the public JWK (to embed in the landing page) and the exact
  `security add-generic-password -U -s rebiosys-e2ee -a laptop -w '<base64 pkcs8>'`
  command for the owner to run. The script never touches the keychain itself.
- `scripts/rebiosys-pull-e2ee` — updated copy of the live puller. Per record:
  no `ciphertext_envelope` → pass through unchanged (legacy plaintext);
  decryptable → decrypted fields + `e2ee: true` stored in inbox.jsonl
  (ciphertext dropped); decryption failure (missing key, wrong key, tamper) →
  record KEPT with `undecryptable: true`, exit code stays 0. Private key read
  from keychain `rebiosys-e2ee`/`laptop` at run time.
- Tests: 13 vitest (round-trip, wrong key, tampered ct/iv/epk, envelope shape,
  10 KB payload, CLI round-trip) + 6 Python unittest
  (`scripts/rebiosys_pull_e2ee_test.py`, stdlib-only) — all green.

## Deployment steps (owner-gated, in order)

1. **Keygen (laptop):** `pnpm --filter @resource-web/relay-crypto exec tsx scripts/keygen.ts`,
   then run the printed `security add-generic-password …` command yourself.
   Keep the printed public JWK for step 3.
2. **Relay patch (questhub :8095):** the intake endpoint additionally accepts
   `{ciphertext_envelope: <envelope>, email?}` — store the record as-is (the
   envelope replaces the plaintext `text`/payload fields), never parse or log
   the envelope contents; `/pending`, ack, `/respond`, `/status/<id>` are
   unchanged (they carry ids and owner-sanitized responses, not the query
   payload). Reject bodies carrying BOTH plaintext payload fields and a
   `ciphertext_envelope` (no downgrade ambiguity). Take a relay data backup
   before deploying (server-writes rule: backups + validate).
3. **Landing form patch:** include `seal.js`, embed the public JWK from step 1,
   encrypt the form payload client-side, POST only `{ciphertext_envelope}`
   (+ email only if the verification-ping option is wanted — leaving email
   inside the sealed payload is the more private default).
4. **Switch the puller:** replace `~/.local/bin/rebiosys-pull` with
   `scripts/rebiosys-pull-e2ee` (or symlink) once steps 1–3 are live.
5. **Only now** update the landing copy from "end-to-end encryption in
   progress" to stating it as actual.

## Key rotation

Generate a new pair (step 1), add the new public JWK to the landing page,
keep BOTH private keys in the keychain during the overlap window
(`rebiosys-e2ee`/`laptop` = current; park the old one under
`rebiosys-e2ee`/`laptop-prev` and let the puller try current-then-prev if a
record fails to unseal), drop the old entry once the relay backlog is drained.
The envelope's `epk` is per message; rotation only concerns the laptop keypair.

## Explicitly out of scope here

Relay deployment itself, landing copy/hero swap, Friendly Captcha, SMTP
notify (external keys / owner decisions), and the per-email verification ping +
agent response webhook (questhub-side; see roadmap 2d).
