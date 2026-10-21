import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encryption at rest for platform secrets (the admin's Cloudflare API token).
 * AES-256-GCM with a key derived from MARSA_SECRETS_KEY (never stored next to
 * the data). Ciphertext format: `v1.<iv>.<tag>.<data>` (base64url parts).
 */
export class SecretBox {
  private readonly key: Buffer;
  constructor(secret: string) {
    if (secret.length < 32) throw new Error("MARSA_SECRETS_KEY must be at least 32 characters");
    this.key = createHash("sha256").update(`marsa-secrets-v1:${secret}`).digest();
  }
  seal(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    const tag = c.getAuthTag();
    return ["v1", iv, tag, data]
      .map((x) => (typeof x === "string" ? x : x.toString("base64url")))
      .join(".");
  }
  open(sealed: string): string {
    const [v, iv, tag, data] = sealed.split(".");
    if (v !== "v1" || !iv || !tag || data === undefined) throw new Error("bad sealed secret");
    const d = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
  }
}
