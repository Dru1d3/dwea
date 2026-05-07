/**
 * Public surface of the per-character memory layer.
 *
 * Wiring guide:
 *   - In tests / harness: `createInMemoryBackend()` + `createMemoryStore`.
 *   - In the browser app:  `createBrowserBackend()` + `createMemoryStore`.
 *   - To talk to Claude with the native memory tool: pass the same store
 *     into `executeMemoryCommand` from `./anthropic.js` per `tool_use` block.
 *
 * Snapshot/mutation helpers in `./snapshot.js` cover the OpenRouter
 * free-tier path the v1 brain runs on today.
 */

export type {
  MemoryIdentity,
  MemoryCommand,
  MemoryCommandResult,
  MemoryBackend,
  CoreMemoryFile,
  BrainMemoryMutation,
} from './types.js';
export { CORE_MEMORY_FILES } from './types.js';

export {
  createMemoryStore,
  createInMemoryBackend,
  scopedPath,
  isSecretPath,
  type MemoryStore,
} from './store.js';

export { createBrowserBackend } from './browserStore.js';

export { createMemoryCipher, rawPayloadLeaksSecret, type MemoryCipher } from './crypto.js';

export {
  loadOrMintUserId,
  mintAnonymousUserId,
  loadCustomerId,
  resolveMemoryIdentity,
  setUserIdForTesting,
} from './identity.js';

export {
  loadMemorySnapshot,
  renderMemoryPreamble,
  applyBrainMutations,
  seedPersonaSecrets,
  clearIdentityMemory,
  type MemorySnapshot,
} from './snapshot.js';

export { memoryToolDefinition, executeMemoryCommand } from './anthropic.js';
