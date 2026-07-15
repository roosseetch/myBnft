import { describe, expect, it } from 'vitest';
import { encrypt, generateKeyBase64 } from '../src/crypto/encrypt.js';
import { decrypt } from '../src/crypto/decrypt.js';

describe('AES-GCM helpers', () => {
  it('round-trips arbitrary text', async () => {
    const key = generateKeyBase64();
    const plaintext = JSON.stringify({
      keyVersion: 3,
      matches: [{ name: 'Family Pod', priceTotal: 123.5 }],
    });
    const blob = await encrypt(plaintext, key);
    expect(blob.iv).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(blob.ciphertext).not.toContain('Family Pod');
    await expect(decrypt(blob, key)).resolves.toBe(plaintext);
  });

  it('uses a fresh IV per encryption (never reuse an IV with the same key)', async () => {
    const key = generateKeyBase64();
    const a = await encrypt('same text', key);
    const b = await encrypt('same text', key);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('fails to decrypt with the wrong key (GCM auth)', async () => {
    const blob = await encrypt('secret', generateKeyBase64());
    await expect(decrypt(blob, generateKeyBase64())).rejects.toThrow();
  });

  it('rejects keys that are not 32 bytes', async () => {
    await expect(encrypt('x', Buffer.from('short').toString('base64'))).rejects.toThrow(/32 bytes/);
  });
});
