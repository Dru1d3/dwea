import { describe, expect, it } from 'vitest';
import { createMemoryCipher, rawPayloadLeaksSecret } from './crypto.js';
import { createInMemoryBackend } from './store.js';

describe('createMemoryCipher', () => {
  it('round-trips a plaintext through encrypt/decrypt', async () => {
    const backend = createInMemoryBackend();
    const cipher = createMemoryCipher(backend);
    const ct = await cipher.encrypt('hello mara');
    expect(ct).not.toContain('hello mara');
    expect(cipher.isEncrypted(ct)).toBe(true);
    expect(await cipher.decrypt(ct)).toBe('hello mara');
  });

  it('produces distinct ciphertext on repeat encryption (random IV)', async () => {
    const backend = createInMemoryBackend();
    const cipher = createMemoryCipher(backend);
    const a = await cipher.encrypt('same plaintext');
    const b = await cipher.encrypt('same plaintext');
    expect(a).not.toBe(b);
  });

  it('refuses to decrypt non-envelope payloads', async () => {
    const backend = createInMemoryBackend();
    const cipher = createMemoryCipher(backend);
    await expect(cipher.decrypt('plain text')).rejects.toThrow(/not an encrypted envelope/);
  });

  it('persists the encryption key in the supplied backend', async () => {
    const backend = createInMemoryBackend();
    const c1 = createMemoryCipher(backend);
    const ct = await c1.encrypt('persist me');

    // Independent cipher pointing at the same backend recovers the key and
    // decrypts what c1 wrote — the cross-session contract.
    const c2 = createMemoryCipher(backend);
    expect(await c2.decrypt(ct)).toBe('persist me');
  });

  it('rawPayloadLeaksSecret detects substring leaks but not encrypted blobs', async () => {
    const backend = createInMemoryBackend();
    const cipher = createMemoryCipher(backend);
    const secret = 'the dog buried the watch in the garden';
    const ct = await cipher.encrypt(`note: ${secret}`);
    expect(rawPayloadLeaksSecret(ct, secret)).toBe(false);
    expect(rawPayloadLeaksSecret(`note: ${secret}`, secret)).toBe(true);
  });
});
