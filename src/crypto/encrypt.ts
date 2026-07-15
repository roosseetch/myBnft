/**
 * AES-GCM (256-bit) encryption via the Web Crypto API (`crypto.subtle`),
 * available natively in Node 19+. We deliberately use Web Crypto rather than
 * the older `crypto.createCipheriv` so the browser dashboard (web/index.html)
 * can mirror this code byte-for-byte.
 *
 * On-disk shape: { iv: base64, ciphertext: base64 } — fresh random 12-byte IV
 * per encryption run; an IV is NEVER reused with the same key.
 */

export interface EncryptedBlob {
  iv: string; // base64
  ciphertext: string; // base64
}

export function generateKeyBase64(): string {
  const bytes = new Uint8Array(32); // 256-bit
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64');
}

export async function importKey(base64Key: string, usage: KeyUsage): Promise<CryptoKey> {
  const raw = Buffer.from(base64Key, 'base64');
  if (raw.length !== 32) {
    throw new Error(`Invalid key: expected 32 bytes (base64), got ${raw.length}`);
  }
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [usage]);
}

export async function encrypt(plaintext: string, base64Key: string): Promise<EncryptedBlob> {
  const key = await importKey(base64Key, 'encrypt');
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    iv: Buffer.from(iv).toString('base64'),
    ciphertext: Buffer.from(ciphertext).toString('base64'),
  };
}
