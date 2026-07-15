import { importKey, type EncryptedBlob } from './encrypt.js';

/** Inverse of encrypt(); throws on wrong key / tampered ciphertext (GCM auth failure). */
export async function decrypt(blob: EncryptedBlob, base64Key: string): Promise<string> {
  const key = await importKey(base64Key, 'decrypt');
  const iv = Buffer.from(blob.iv, 'base64');
  const ciphertext = Buffer.from(blob.ciphertext, 'base64');
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}
