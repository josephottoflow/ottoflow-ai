/**
 * Integration secret encryption — AES-256-GCM (Phase 3 / P0).
 *
 * OAuth access/refresh tokens for connected accounts (Drive, LinkedIn, …) are
 * NEVER stored or transmitted in plaintext. They are encrypted at the
 * application layer before they touch Postgres and decrypted only server-side
 * (route handlers + the BullMQ worker) immediately before a provider call.
 *
 * Envelope format (string, DB-safe, self-describing):
 *
 *   v1.<ivB64>.<tagB64>.<ciphertextB64>
 *
 *   - v1     version tag (lets us rotate algorithm/format later, additively)
 *   - iv     96-bit random nonce per encryption (GCM best practice)
 *   - tag    128-bit GCM auth tag (integrity — tampering fails decryption)
 *   - ct     AES-256-GCM ciphertext
 *
 * Key: `INTEGRATIONS_ENC_KEY` — a 32-byte key supplied base64 (preferred) or
 * hex. Generate with:  openssl rand -base64 32
 *
 * AAD (additional authenticated data): callers SHOULD bind each ciphertext to
 * its owner+provider (e.g. `${provider}:${userId}`) so a row's token cannot be
 * copied into another row and still decrypt. The same AAD must be supplied to
 * decrypt.
 *
 * This module is server-only by convention (the key is undefined in the
 * browser). It deliberately does NOT register with env.ts/worker-env.ts: in
 * P0 no provider consumes it yet, so production (which has no key set) must
 * not fail boot. Validation is lazy — it throws with a clear message only when
 * encrypt/decrypt is actually called.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const ALGO = "aes-256-gcm";
const IV_LEN = 12; // 96-bit nonce — recommended for GCM
const KEY_LEN = 32; // AES-256

let cachedKey: Buffer | null = null;

/** Load + validate the 32-byte key once. Accepts base64 or 64-char hex. */
function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.INTEGRATIONS_ENC_KEY;
  if (!raw) {
    throw new Error(
      "INTEGRATIONS_ENC_KEY is not set — required to encrypt/decrypt integration tokens. " +
        "Generate one with `openssl rand -base64 32`.",
    );
  }
  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (key.length !== KEY_LEN) {
    throw new Error(
      `INTEGRATIONS_ENC_KEY must decode to ${KEY_LEN} bytes (got ${key.length}). ` +
        "Provide a base64- or hex-encoded 256-bit key (`openssl rand -base64 32`).",
    );
  }
  cachedKey = key;
  return key;
}

/** Encrypt a UTF-8 secret. Returns the `v1.iv.tag.ct` envelope string. */
export function encryptSecret(plaintext: string, aad?: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(".");
}

/**
 * Decrypt a `v1.iv.tag.ct` envelope. Throws if the key is missing, the format
 * is wrong, or the auth tag fails (tampered ciphertext or wrong AAD/key).
 */
export function decryptSecret(payload: string, aad?: string): string {
  const key = loadKey();
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Malformed or unsupported integration secret envelope.");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
  if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** True if a valid 32-byte INTEGRATIONS_ENC_KEY is configured. Never throws. */
export function isEncryptionConfigured(): boolean {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}

/** Stable AAD binding a secret to its owner + provider. */
export function secretAad(provider: string, userId: string): string {
  return `${provider}:${userId}`;
}
