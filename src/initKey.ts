import { generateKeyBase64 } from './crypto/encrypt.js';

/**
 * One-time helper: prints a fresh 256-bit AES key (base64) to paste into the
 * repo variable MYCAMP_ENCRYPTION_KEY (Settings → Secrets and variables →
 * Actions → Variables). Run locally only — never in a public CI log.
 */
console.log(generateKeyBase64());
