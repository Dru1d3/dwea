import { describe, expect, it } from 'vitest';
import { executeMemoryCommand, memoryToolDefinition } from './anthropic.js';
import { createInMemoryBackend, createMemoryStore } from './store.js';
import type { MemoryIdentity } from './types.js';

const ID: MemoryIdentity = { customerId: '_default', characterId: 'mara', userId: 'u-test' };

function freshStore() {
  return createMemoryStore(createInMemoryBackend(), ID);
}

describe('memoryToolDefinition', () => {
  it('reports the documented Claude memory-tool type', () => {
    const def = memoryToolDefinition();
    expect(def.type).toBe('memory_20250818');
    expect(def.name).toBe('memory');
  });
});

describe('executeMemoryCommand — Anthropic surface', () => {
  it('create + view round-trip', async () => {
    const store = freshStore();
    await executeMemoryCommand(store, {
      command: 'create',
      path: '/memories/notes.md',
      file_text: 'line one\nline two',
    });
    const r = await executeMemoryCommand(store, { command: 'view', path: '/memories/notes.md' });
    expect(r.output).toBe('line one\nline two');
  });

  it('view with a 1-indexed range slices the file', async () => {
    const store = freshStore();
    await executeMemoryCommand(store, {
      command: 'create',
      path: '/memories/notes.md',
      file_text: 'a\nb\nc\nd\ne',
    });
    const r = await executeMemoryCommand(store, {
      command: 'view',
      path: '/memories/notes.md',
      view_range: [2, 4],
    });
    expect(r.output).toBe('b\nc\nd');
  });

  it('view on a directory returns a listing', async () => {
    const store = freshStore();
    await executeMemoryCommand(store, {
      command: 'create',
      path: '/memories/a.md',
      file_text: '1',
    });
    await executeMemoryCommand(store, {
      command: 'create',
      path: '/memories/sub/b.md',
      file_text: '2',
    });
    const r = await executeMemoryCommand(store, { command: 'view', path: '/memories' });
    expect(r.output).toContain('Directory');
    expect(r.output).toMatch(/a\.md/);
    expect(r.output).toMatch(/b\.md/);
  });

  it('str_replace targets a single occurrence', async () => {
    const store = freshStore();
    await executeMemoryCommand(store, {
      command: 'create',
      path: '/memories/notes.md',
      file_text: 'their name is Sam',
    });
    await executeMemoryCommand(store, {
      command: 'str_replace',
      path: '/memories/notes.md',
      old_str: 'Sam',
      new_str: 'Sammy',
    });
    expect(await store.read('/memories/notes.md')).toBe('their name is Sammy');
  });

  it('str_replace refuses ambiguous matches', async () => {
    const store = freshStore();
    await executeMemoryCommand(store, {
      command: 'create',
      path: '/memories/notes.md',
      file_text: 'Sam met Sam in the garden',
    });
    await expect(
      executeMemoryCommand(store, {
        command: 'str_replace',
        path: '/memories/notes.md',
        old_str: 'Sam',
        new_str: 'Sammy',
      }),
    ).rejects.toThrow(/more than once/);
  });

  it('insert is 1-indexed and clamps over-runs', async () => {
    const store = freshStore();
    await executeMemoryCommand(store, {
      command: 'create',
      path: '/memories/notes.md',
      file_text: 'a\nb\nc',
    });
    await executeMemoryCommand(store, {
      command: 'insert',
      path: '/memories/notes.md',
      insert_line: 1,
      insert_text: 'inserted',
    });
    expect(await store.read('/memories/notes.md')).toBe('a\ninserted\nb\nc');

    await executeMemoryCommand(store, {
      command: 'insert',
      path: '/memories/notes.md',
      insert_line: 999,
      insert_text: 'tail',
    });
    expect((await store.read('/memories/notes.md'))?.endsWith('tail')).toBe(true);
  });

  it('delete returns a noop result when the path is missing', async () => {
    const store = freshStore();
    const r = await executeMemoryCommand(store, {
      command: 'delete',
      path: '/memories/missing.md',
    });
    expect(r.output).toMatch(/noop/);
  });

  it('rename moves a file', async () => {
    const store = freshStore();
    await executeMemoryCommand(store, {
      command: 'create',
      path: '/memories/old.md',
      file_text: 'value',
    });
    await executeMemoryCommand(store, {
      command: 'rename',
      old_path: '/memories/old.md',
      new_path: '/memories/new.md',
    });
    expect(await store.read('/memories/old.md')).toBeNull();
    expect(await store.read('/memories/new.md')).toBe('value');
  });
});
