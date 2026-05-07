import { describe, expect, it } from 'vitest';
import { rawPayloadLeaksSecret } from './crypto.js';
import { createInMemoryBackend, createMemoryStore, isSecretPath, scopedPath } from './store.js';
import type { MemoryIdentity } from './types.js';

const ID: MemoryIdentity = {
  customerId: 'acme',
  characterId: 'mara',
  userId: 'u-1',
};

const ID_OTHER_USER: MemoryIdentity = { ...ID, userId: 'u-2' };
const ID_OTHER_CHAR: MemoryIdentity = { ...ID, characterId: 'kraken' };
const ID_OTHER_CUSTOMER: MemoryIdentity = { ...ID, customerId: 'globex' };

describe('scopedPath', () => {
  it('namespaces relative paths under (customer, character, user)', () => {
    expect(scopedPath(ID, 'facts_about_user.md')).toBe(
      '/memories/acme/mara/u-1/facts_about_user.md',
    );
  });

  it('passes through already-scoped paths', () => {
    const already = '/memories/acme/mara/u-1/facts_about_user.md';
    expect(scopedPath(ID, already)).toBe(already);
  });

  it('re-scopes a /memories/-rooted path that points at another customer', () => {
    expect(scopedPath(ID, '/memories/globex/mara/u-2/leaked.md')).toBe(
      '/memories/acme/mara/u-1/leaked.md',
    );
  });

  it('returns the root for empty / "/" inputs', () => {
    expect(scopedPath(ID, '')).toBe('/memories/acme/mara/u-1');
    expect(scopedPath(ID, '/')).toBe('/memories/acme/mara/u-1');
  });
});

describe('isSecretPath', () => {
  it('flags any path inside /secrets/', () => {
    expect(isSecretPath('/memories/acme/mara/u-1/secrets/foo.md')).toBe(true);
    expect(isSecretPath('/memories/acme/mara/u-1/secrets/_persona.md')).toBe(true);
  });
  it('does not flag plain memory paths', () => {
    expect(isSecretPath('/memories/acme/mara/u-1/facts_about_user.md')).toBe(false);
  });
});

describe('MemoryStore', () => {
  it('round-trips plain content', async () => {
    const backend = createInMemoryBackend();
    const store = createMemoryStore(backend, ID);
    await store.write('facts_about_user.md', '- name: Sam');
    const read = await store.read('facts_about_user.md');
    expect(read).toBe('- name: Sam');
    // Persisted at the namespaced path.
    expect(backend.snapshot().get('/memories/acme/mara/u-1/facts_about_user.md')).toBe(
      '- name: Sam',
    );
  });

  it('isolates per-customer / per-character / per-user', async () => {
    const backend = createInMemoryBackend();
    const a = createMemoryStore(backend, ID);
    const b = createMemoryStore(backend, ID_OTHER_USER);
    const c = createMemoryStore(backend, ID_OTHER_CHAR);
    const d = createMemoryStore(backend, ID_OTHER_CUSTOMER);
    await a.write('facts_about_user.md', 'A');
    await b.write('facts_about_user.md', 'B');
    await c.write('facts_about_user.md', 'C');
    await d.write('facts_about_user.md', 'D');
    expect(await a.read('facts_about_user.md')).toBe('A');
    expect(await b.read('facts_about_user.md')).toBe('B');
    expect(await c.read('facts_about_user.md')).toBe('C');
    expect(await d.read('facts_about_user.md')).toBe('D');
  });

  it('encrypts files written under /secrets/ at rest', async () => {
    const backend = createInMemoryBackend();
    const store = createMemoryStore(backend, ID);
    const secret = 'the surprise party is on saturday';
    await store.write('secrets/whisper.md', secret);

    // Read-through decrypts.
    expect(await store.read('secrets/whisper.md')).toBe(secret);

    // Raw audit shows ciphertext, never the cleartext substring.
    const raw = await store.readRawForAudit('secrets/whisper.md');
    expect(raw).not.toBeNull();
    expect(raw).not.toBe(secret);
    expect(rawPayloadLeaksSecret(raw ?? '', secret)).toBe(false);
    expect(store.cipher.isEncrypted(raw ?? '')).toBe(true);
  });

  it('does NOT encrypt non-secret paths', async () => {
    const backend = createInMemoryBackend();
    const store = createMemoryStore(backend, ID);
    await store.write('facts_about_user.md', 'plain note');
    const raw = await store.readRawForAudit('facts_about_user.md');
    expect(raw).toBe('plain note');
  });

  it('re-encrypts on rename across the secrets boundary', async () => {
    const backend = createInMemoryBackend();
    const store = createMemoryStore(backend, ID);
    await store.write('facts_about_user.md', 'private fact');
    await store.rename('facts_about_user.md', 'secrets/lifted.md');
    const moved = await store.readRawForAudit('secrets/lifted.md');
    expect(moved).not.toBe('private fact');
    expect(store.cipher.isEncrypted(moved ?? '')).toBe(true);
    expect(await store.read('secrets/lifted.md')).toBe('private fact');
    // And the source path is gone.
    expect(await store.read('facts_about_user.md')).toBeNull();
  });

  it('decrypts on rename leaving the secrets boundary', async () => {
    const backend = createInMemoryBackend();
    const store = createMemoryStore(backend, ID);
    const cleartext = 'the dog is named Comet';
    await store.write('secrets/note.md', cleartext);
    await store.rename('secrets/note.md', 'facts_about_user.md');
    const raw = await store.readRawForAudit('facts_about_user.md');
    expect(raw).toBe(cleartext);
    expect(store.cipher.isEncrypted(raw ?? '')).toBe(false);
  });

  it('lists only paths under the (customer, character, user) tuple', async () => {
    const backend = createInMemoryBackend();
    const a = createMemoryStore(backend, ID);
    const b = createMemoryStore(backend, ID_OTHER_USER);
    await a.write('facts_about_user.md', 'A1');
    await a.write('important_events.md', 'A2');
    await b.write('facts_about_user.md', 'B1');
    const aPaths = await a.list('');
    expect(aPaths.every((p) => p.startsWith('/memories/acme/mara/u-1/'))).toBe(true);
    expect(aPaths.length).toBeGreaterThanOrEqual(2);
  });

  it('survives reload via shared backend (cross-session simulation)', async () => {
    const backend = createInMemoryBackend();
    const session1 = createMemoryStore(backend, ID);
    await session1.write('facts_about_user.md', 'Sam likes the brightest corner');

    // Simulate the user closing the tab and returning later — same backend
    // (IndexedDB on disk in production), brand new store instance.
    const session2 = createMemoryStore(backend, ID);
    expect(await session2.read('facts_about_user.md')).toBe('Sam likes the brightest corner');
  });
});
