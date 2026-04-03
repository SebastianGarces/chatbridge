import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer | null {
  const keyHex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!keyHex) return null;
  const buf = Buffer.from(keyHex, "hex");
  if (buf.length !== 32) {
    console.warn(
      "[crypto] TOKEN_ENCRYPTION_KEY must be 64 hex chars (32 bytes). Falling back to base64."
    );
    return null;
  }
  return buf;
}

/**
 * Encrypt a plaintext string.
 * Returns `iv:ciphertext:tag` as hex when TOKEN_ENCRYPTION_KEY is set.
 * Falls back to base64 encoding in dev when the key is missing.
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  if (!key) {
    // Dev fallback — base64 (NOT secure, just prevents storing raw tokens)
    if (!warnedMissingKey) {
      console.warn(
        "[crypto] TOKEN_ENCRYPTION_KEY not set — using base64 fallback (dev only)"
      );
      warnedMissingKey = true;
    }
    return `b64:${Buffer.from(plaintext, "utf8").toString("base64")}`;
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${encrypted.toString("hex")}:${tag.toString("hex")}`;
}

/**
 * Decrypt a string produced by `encrypt()`.
 * Handles both the AES-256-GCM format and the base64 dev fallback.
 */
export function decrypt(encoded: string): string {
  // Dev fallback
  if (encoded.startsWith("b64:")) {
    return Buffer.from(encoded.slice(4), "base64").toString("utf8");
  }

  const key = getEncryptionKey();
  if (!key) {
    throw new Error(
      "Cannot decrypt AES token without TOKEN_ENCRYPTION_KEY env var"
    );
  }

  const parts = encoded.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted token format (expected iv:ciphertext:tag)");
  }

  const [ivHex, ciphertextHex, tagHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const tag = Buffer.from(tagHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

let warnedMissingKey = false;
