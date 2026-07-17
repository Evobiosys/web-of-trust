// Account provisioning — synapse admin shared-secret registration (§ task-m2t-brief.md).
//
// Flow: GET /_synapse/admin/v1/register for a nonce, HMAC-SHA1 it together
// with (nonce, username, password, "notadmin") using the registration
// shared secret, POST it back. Idempotent: shared-secret registration of an
// *existing* user errors with M_USER_IN_USE — the fallback is a normal
// password login using a password derived deterministically from the same
// secret (HMAC-SHA256(secret, localpart)), which is also the password set
// at registration time, so the same derivation works on both paths.
import { createHmac } from "node:crypto";
import "./matrix_crypto_stub.js"; // must precede the matrix-bot-sdk import — see that file's header
import { MatrixAuth, MatrixClient } from "matrix-bot-sdk";

export interface ProvisionConfig {
  homeserver_url: string;
  /** Full matrix user id, e.g. "@anna-agent:wot.local". */
  self: string;
  registration_secret: string;
}

interface RegisterNonceResponse {
  nonce: string;
}

interface RegisterSuccessResponse {
  access_token: string;
  user_id: string;
  home_server?: string;
  device_id?: string;
}

interface MatrixErrorResponse {
  errcode?: string;
  error?: string;
}

/** Localpart of a full matrix user id: "@anna-agent:wot.local" -> "anna-agent". */
export function localpartOf(mxid: string): string {
  const match = /^@([^:]+):(.+)$/.exec(mxid);
  if (!match) throw new Error(`not a valid matrix user id (expected "@localpart:server"): ${mxid}`);
  return match[1];
}

/** Deterministic password for a given localpart, derived from the registration shared secret. */
export function derivePassword(registrationSecret: string, localpart: string): string {
  return createHmac("sha256", registrationSecret).update(localpart, "utf8").digest("hex");
}

function computeRegistrationMac(params: {
  secret: string;
  nonce: string;
  username: string;
  password: string;
  admin: boolean;
}): string {
  const hmac = createHmac("sha1", params.secret);
  hmac.update(params.nonce, "utf8");
  hmac.update("\x00", "utf8");
  hmac.update(params.username, "utf8");
  hmac.update("\x00", "utf8");
  hmac.update(params.password, "utf8");
  hmac.update("\x00", "utf8");
  hmac.update(params.admin ? "admin" : "notadmin", "utf8");
  return hmac.digest("hex");
}

/**
 * Attempts shared-secret registration. Returns the fresh access token on
 * success, or `{ conflict: true }` if the account already exists — the
 * caller falls back to password login in that case.
 */
async function registerViaSharedSecret(
  homeserverUrl: string,
  secret: string,
  localpart: string,
  password: string
): Promise<{ access_token: string; user_id: string } | { conflict: true }> {
  const registerUrl = `${homeserverUrl}/_synapse/admin/v1/register`;

  const nonceRes = await fetch(registerUrl);
  if (!nonceRes.ok) {
    throw new Error(`failed to fetch registration nonce (${nonceRes.status}): ${await nonceRes.text()}`);
  }
  const { nonce } = (await nonceRes.json()) as RegisterNonceResponse;

  const mac = computeRegistrationMac({ secret, nonce, username: localpart, password, admin: false });

  const res = await fetch(registerUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nonce, username: localpart, password, admin: false, mac }),
  });

  if (res.status === 400) {
    const body = (await res.json().catch(() => ({}))) as MatrixErrorResponse;
    if (body.errcode === "M_USER_IN_USE") {
      return { conflict: true };
    }
    throw new Error(`registration rejected (400): ${body.errcode ?? "?"} ${body.error ?? ""}`);
  }
  if (!res.ok) {
    throw new Error(`registration failed (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as RegisterSuccessResponse;
  return { access_token: body.access_token, user_id: body.user_id };
}

/**
 * Provisions (or logs into) the account named by `cfg.self`, returning a
 * ready-to-use MatrixClient. Idempotent: safe to call every process start.
 */
export async function provisionMatrixClient(cfg: ProvisionConfig): Promise<MatrixClient> {
  const localpart = localpartOf(cfg.self);
  const password = derivePassword(cfg.registration_secret, localpart);

  const result = await registerViaSharedSecret(cfg.homeserver_url, cfg.registration_secret, localpart, password);
  if ("conflict" in result) {
    const auth = new MatrixAuth(cfg.homeserver_url);
    return auth.passwordLogin(localpart, password, "resource-web-transport");
  }
  return new MatrixClient(cfg.homeserver_url, result.access_token);
}
