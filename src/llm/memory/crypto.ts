/**
 * Encryption-at-rest for memory files marked as persona secrets.
 *
 * AES-GCM 256 via Web Crypto. The key is generated once per browser, stored
 * unwrapped under a fixed path in the same memory backend that holds the
 * memory files themselves. That gives us:
 *
 *   - **Origin-bound** key material — IndexedDB partitions per origin, so a
 *     cross-site script can't fetch the key without a same-origin breach.
 *   - **Leaked-export resistance** — the threat model the issue calls out
 *     ("a leaked memory file doesn't spoil the experience") covers the
 *     case where a user (or a debugger / backup tool) dumps the memory file
 *     contents. The dump is ciphertext; without the key entry it's noise.
 *
 * What this is **not**: a defence against an attacker with active JS on the
 * page. That attacker can read the key directly. v1 does not aim higher —
 * the secrets are flavour-of-the-monster facts, not credentials. ADR 0010
 * §Threat model documents the escalation path (server-side persistence,
 * Argon2-wrapped key) we'd take if the threat model ever changes.
 */

import type { MemoryBackend } from './types.js';

const KEY_PATH = '/memories/_system/encryption-key.v1';
const KEY_ALG = 'AES-GCM' as const;
const KEY_LENGTH = 256;
const IV_LENGTH = 12; // 96-bit IVs are mandatory for AES-GCM.

interface SubtleLike {
  generateKey(
    algorithm: AesKeyGenParams,
    extractable: boolean,
    keyUsages: ReadonlyArray<KeyUsage>,
  ): Promise<CryptoKey>;
  exportKey(format: 'raw', key: CryptoKey): Promise<ArrayBuffer>;
  importKey(
    format: 'raw',
    keyData: BufferSource,
    algorithm: AesKeyAlgorithm,
    extractable: boolean,
    keyUsages: ReadonlyArray<KeyUsage>,
  ): Promise<CryptoKey>;
  encrypt(algorithm: AesGcmParams, key: CryptoKey, data: BufferSource): Promise<ArrayBuffer>;
  decrypt(algorithm: AesGcmParams, key: CryptoKey, data: BufferSource): Promise<ArrayBuffer>;
}

function subtle(): SubtleLike {
  const s = globalThis.crypto?.subtle as SubtleLike | undefined;
  if (!s) {
    throw new Error('memory: Web Crypto subtle API unavailable');
  }
  return s;
}

function bytesToBase64(view: Uint8Array): string {
  let s = '';
  for (const b of view) s += String.fromCharCode(b);
  if (typeof globalThis.btoa === 'function') return globalThis.btoa(s);
  // Node 20 has Buffer; vitest happens to too. Fall through if neither.
  type BufLike = { from: (s: string, enc: string) => { toString: (enc: string) => string } };
  const bufFactory = (globalThis as { Buffer?: BufLike }).Buffer;
  if (bufFactory) return bufFactory.from(s, 'binary').toString('base64');
  throw new Error('memory: no base64 encoder available');
}

/**
 * Base64-decode into an ArrayBuffer-backed Uint8Array. We pin the backing
 * buffer to `ArrayBuffer` (not `ArrayBufferLike`, the default for `new
 * Uint8Array(n)` under TS 5.7+) so the result is unambiguously a
 * `BufferSource` Web Crypto will accept.
 */
function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  let bin: string;
  if (typeof globalThis.atob === 'function') {
    bin = globalThis.atob(b64);
  } else {
    type BufLike = { from: (s: string, enc: string) => { toString: (enc: string) => string } };
    const bufFactory = (globalThis as { Buffer?: BufLike }).Buffer;
    if (!bufFactory) throw new Error('memory: no base64 decoder available');
    bin = bufFactory.from(b64, 'base64').toString('binary');
  }
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function randomIv(): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(IV_LENGTH);
  const iv = new Uint8Array(buf);
  globalThis.crypto.getRandomValues(iv);
  return iv;
}

interface KeyEnvelope {
  v: 1;
  alg: 'AES-GCM-256';
  /** Raw key bytes, base64-encoded. */
  k: string;
}

async function generateKey(): Promise<CryptoKey> {
  return subtle().generateKey({ name: KEY_ALG, length: KEY_LENGTH }, true, ['encrypt', 'decrypt']);
}

async function exportKeyEnvelope(key: CryptoKey): Promise<KeyEnvelope> {
  const raw = await subtle().exportKey('raw', key);
  return { v: 1, alg: 'AES-GCM-256', k: bytesToBase64(new Uint8Array(raw)) };
}

async function importKeyEnvelope(envelope: KeyEnvelope): Promise<CryptoKey> {
  if (envelope.v !== 1 || envelope.alg !== 'AES-GCM-256') {
    throw new Error(`memory: unsupported key envelope ${envelope.v}/${envelope.alg}`);
  }
  const raw = base64ToBytes(envelope.k);
  return subtle().importKey('raw', raw, { name: KEY_ALG, length: KEY_LENGTH }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * Lazy-load (or first-time-mint) the encryption key. Persisted in the same
 * MemoryBackend the secrets live in — keeping all memory state in one place
 * simplifies reset-on-debug ("clear memory" wipes both keys and content).
 */
async function loadOrMintKey(backend: MemoryBackend): Promise<CryptoKey> {
  const raw = await backend.read(KEY_PATH);
  if (raw && raw.length > 0) {
    try {
      const env = JSON.parse(raw) as KeyEnvelope;
      return await importKeyEnvelope(env);
    } catch (err) {
      throw new Error(`memory: key envelope corrupted (${(err as Error).message})`);
    }
  }
  const key = await generateKey();
  const env = await exportKeyEnvelope(key);
  await backend.write(KEY_PATH, JSON.stringify(env));
  return key;
}

/**
 * Wire-format ciphertext blob written to disk. Versioned so a future
 * algorithm change (e.g. moving to a wrapped key, switching to ChaCha20) can
 * coexist with v1 entries without a bulk re-encrypt migration.
 */
interface CipherEnvelope {
  v: 1;
  alg: 'AES-GCM-256';
  iv: string; // base64
  ct: string; // base64
}

const ENCRYPTED_PREFIX = '@@enc:v1:';

export interface MemoryCipher {
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
  /** True when the input payload was produced by `encrypt`. */
  isEncrypted(payload: string): boolean;
}

/**
 * Build a cipher bound to the supplied backend. The key is fetched (or
 * minted) on the first call and cached for the lifetime of the cipher
 * instance — repeated `encrypt`/`decrypt` calls do NOT round-trip to
 * IndexedDB after the first.
 */
export function createMemoryCipher(backend: MemoryBackend): MemoryCipher {
  let keyPromise: Promise<CryptoKey> | null = null;
  function key(): Promise<CryptoKey> {
    if (!keyPromise) keyPromise = loadOrMintKey(backend);
    return keyPromise;
  }

  return {
    async encrypt(plaintext: string): Promise<string> {
      const k = await key();
      const iv = randomIv();
      const data = new TextEncoder().encode(plaintext);
      const ct = await subtle().encrypt({ name: KEY_ALG, iv }, k, data);
      const env: CipherEnvelope = {
        v: 1,
        alg: 'AES-GCM-256',
        iv: bytesToBase64(iv),
        ct: bytesToBase64(new Uint8Array(ct)),
      };
      return `${ENCRYPTED_PREFIX}${JSON.stringify(env)}`;
    },
    async decrypt(ciphertext: string): Promise<string> {
      if (!ciphertext.startsWith(ENCRYPTED_PREFIX)) {
        throw new Error('memory: payload is not an encrypted envelope');
      }
      const json = ciphertext.slice(ENCRYPTED_PREFIX.length);
      let env: CipherEnvelope;
      try {
        env = JSON.parse(json) as CipherEnvelope;
      } catch (err) {
        throw new Error(`memory: cipher envelope corrupted (${(err as Error).message})`);
      }
      if (env.v !== 1 || env.alg !== 'AES-GCM-256') {
        throw new Error(`memory: unsupported cipher ${env.v}/${env.alg}`);
      }
      const k = await key();
      const iv = base64ToBytes(env.iv);
      const ct = base64ToBytes(env.ct);
      const pt = await subtle().decrypt({ name: KEY_ALG, iv }, k, ct);
      return new TextDecoder().decode(pt);
    },
    isEncrypted(payload: string): boolean {
      return payload.startsWith(ENCRYPTED_PREFIX);
    },
  };
}

/**
 * Helper for recall-harness assertions: scan a raw on-disk payload for any
 * substring of `secret`. Returns true if the secret appears in plain text —
 * i.e. encryption did not in fact apply. Intended ONLY for tests.
 */
export function rawPayloadLeaksSecret(payload: string, secret: string): boolean {
  if (secret.length === 0) return false;
  return payload.includes(secret);
}
