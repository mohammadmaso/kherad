import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey(): Buffer {
  const secret = process.env.GIT_REMOTE_SECRET_KEY;
  if (!secret) {
    throw new Error("GIT_REMOTE_SECRET_KEY is not set");
  }
  return createHash("sha256").update(secret).digest();
}

/** Encrypts a remote access token for storage in Postgres (document remote / AI settings). */
export function encryptRemoteToken(token: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((b) => b.toString("base64")).join(".");
}

/** Reverses `encryptRemoteToken`. Throws if `ciphertext` is malformed or the key doesn't match. */
export function decryptRemoteToken(ciphertext: string): string {
  const [ivPart, authTagPart, dataPart] = ciphertext.split(".");
  if (!ivPart || !authTagPart || !dataPart) {
    throw new Error("Malformed remote token ciphertext");
  }
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivPart, "base64"));
  decipher.setAuthTag(Buffer.from(authTagPart, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
