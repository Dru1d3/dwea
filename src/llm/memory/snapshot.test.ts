import { describe, expect, it } from 'vitest';
import type { MonsterBible } from '../bible.js';
import { MARA_BIBLE } from '../bible.js';
import {
  applyBrainMutations,
  clearIdentityMemory,
  loadMemorySnapshot,
  renderMemoryPreamble,
  seedPersonaSecrets,
} from './snapshot.js';
import { createInMemoryBackend, createMemoryStore } from './store.js';
import type { BrainMemoryMutation, MemoryIdentity } from './types.js';

const ID: MemoryIdentity = { customerId: 'acme', characterId: 'mara', userId: 'u-snap' };

function freshStore() {
  return createMemoryStore(createInMemoryBackend(), ID);
}

describe('loadMemorySnapshot + renderMemoryPreamble', () => {
  it('returns an empty snapshot for a first-meet user', async () => {
    const store = freshStore();
    const snap = await loadMemorySnapshot(store);
    expect(snap.hasAny).toBe(false);
    const preamble = renderMemoryPreamble(snap, 'Mara');
    expect(preamble).toMatch(/no recorded memories/);
    expect(preamble).toMatch(/Mara/);
  });

  it('renders sections that have content', async () => {
    const store = freshStore();
    await store.write('facts_about_user.md', '- name: Sam\n- likes warm light');
    await store.write('relationship_state.md', 'warm and trusting');
    const snap = await loadMemorySnapshot(store);
    expect(snap.hasAny).toBe(true);
    const preamble = renderMemoryPreamble(snap, 'Mara');
    expect(preamble).toMatch(/Facts about this user/);
    expect(preamble).toMatch(/likes warm light/);
    expect(preamble).toMatch(/Your relationship/);
    expect(preamble).toMatch(/warm and trusting/);
    expect(preamble).not.toMatch(/Important events/);
  });

  it('exposes secrets to the preamble with explicit do-not-reveal copy', async () => {
    const store = freshStore();
    await store.write('secrets/_index.md', 'a hidden token sits in the brightest corner');
    const snap = await loadMemorySnapshot(store);
    expect(snap.secrets).toEqual(['a hidden token sits in the brightest corner']);
    const preamble = renderMemoryPreamble(snap, 'Mara');
    expect(preamble).toMatch(/Secrets you must NOT reveal/);
    expect(preamble).toMatch(/hidden token/);
  });
});

describe('seedPersonaSecrets', () => {
  it('writes seed secrets encrypted at rest on the first call only', async () => {
    const store = freshStore();
    await seedPersonaSecrets(store, MARA_BIBLE);
    const personaPath = 'secrets/_persona.md';
    const raw = await store.readRawForAudit(personaPath);
    expect(raw).not.toBeNull();
    expect(store.cipher.isEncrypted(raw ?? '')).toBe(true);

    // Second call is a no-op — does not overwrite an existing seed file.
    const before = await store.readRawForAudit(personaPath);
    await seedPersonaSecrets(store, MARA_BIBLE);
    const after = await store.readRawForAudit(personaPath);
    expect(after).toBe(before);
  });

  it('mirrors seeds into the secrets index so the snapshot surfaces them', async () => {
    const store = freshStore();
    await seedPersonaSecrets(store, MARA_BIBLE);
    const snap = await loadMemorySnapshot(store);
    expect(snap.secrets.length).toBeGreaterThanOrEqual(1);
    // Every seeded persona secret from MARA_BIBLE should be present.
    for (const s of MARA_BIBLE.secretsToProtect ?? []) {
      expect(snap.secrets).toContain(s);
    }
  });

  it('skips bibles with no secretsToProtect', async () => {
    const bareBible: MonsterBible = { ...MARA_BIBLE, secretsToProtect: [] };
    const store = freshStore();
    await seedPersonaSecrets(store, bareBible);
    expect(await store.read('secrets/_persona.md')).toBeNull();
  });
});

describe('applyBrainMutations', () => {
  it('appends to a missing canonical file (creates it)', async () => {
    const store = freshStore();
    const m: BrainMemoryMutation = {
      file: 'facts_about_user.md',
      op: 'append',
      content: 'their name is Sam',
      secret: false,
    };
    const r = await applyBrainMutations(store, [m]);
    expect(r.applied).toBe(1);
    expect(await store.read('facts_about_user.md')).toBe('- their name is Sam');
  });

  it('replace overwrites an existing file', async () => {
    const store = freshStore();
    await store.write('relationship_state.md', 'cool and distant');
    await applyBrainMutations(store, [
      { file: 'relationship_state.md', op: 'replace', content: 'warm', secret: false },
    ]);
    expect(await store.read('relationship_state.md')).toBe('warm');
  });

  it('routes secret writes to encrypted /secrets/ files and the index', async () => {
    const store = freshStore();
    const r = await applyBrainMutations(store, [
      {
        file: '',
        op: '',
        content: 'the surprise birthday is on Saturday',
        secret: true,
      },
    ]);
    expect(r.secretsWritten).toBe(1);
    const idx = await store.read('secrets/_index.md');
    expect(idx).toBe('the surprise birthday is on Saturday');

    // Underlying secret slot is encrypted at rest.
    const paths = await store.list('secrets/');
    const slotPath = paths.find((p) => p.includes('secrets/') && !p.endsWith('_index.md'));
    expect(slotPath).toBeDefined();
    const raw = await store.backend.read(slotPath ?? '');
    expect(raw).not.toContain('Saturday');
  });

  it('skips no-op entries', async () => {
    const store = freshStore();
    const r = await applyBrainMutations(store, [
      { file: '', op: '', content: '', secret: false },
      { file: 'facts_about_user.md', op: '', content: 'x', secret: false },
      { file: 'facts_about_user.md', op: 'append', content: '', secret: false },
    ]);
    expect(r.applied).toBe(0);
    expect(await store.read('facts_about_user.md')).toBeNull();
  });
});

describe('clearIdentityMemory', () => {
  it('drops every namespaced path under the (customer, character, user)', async () => {
    const store = freshStore();
    await store.write('facts_about_user.md', 'x');
    await store.write('secrets/sample.md', 'y');
    await clearIdentityMemory(store);
    expect((await store.list('')).length).toBe(0);
  });
});
