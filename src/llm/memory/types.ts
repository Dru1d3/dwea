/**
 * Type surface for the per-character memory layer.
 *
 * The shape mirrors the Anthropic Claude memory-tool contract
 * (memory_20250818) — `view` / `create` / `str_replace` / `insert` / `delete`
 * / `rename` commands operating on `/memories/...` paths — so the same backing
 * store serves both:
 *   (a) the application-level memory loop we run today against OpenRouter
 *       (snapshot-on-session-start, mutation-via-envelope), and
 *   (b) a future native Claude tool-use loop that hands these commands
 *       directly to the memory tool.
 *
 * Keeping the contract identical means `swap brain → Claude` is a wiring
 * change, not a memory-layer rewrite. See ADR 0010 for the trade-off.
 */

/**
 * Identity tuple used to scope every memory operation. The store namespaces
 * paths so a `secrets.md` in (customer A, character X, user 1) never leaks
 * into (customer B, character X, user 1) — required for v2 multi-tenant.
 */
export interface MemoryIdentity {
  /** Top-level isolation. Stays "_default" for the v1 demo. */
  readonly customerId: string;
  /** Bible id, e.g. "mara". */
  readonly characterId: string;
  /** Stable per-browser anonymous id (see identity.ts). */
  readonly userId: string;
}

/**
 * Result of a successful memory-tool command. The brain expects a string
 * payload it can echo back into the next turn's context (the way Claude's
 * tool harness wires it). Errors are thrown — callers map them onto Claude's
 * `is_error` tool result if they're driving the native tool API.
 */
export interface MemoryCommandResult {
  ok: true;
  /** Human-readable payload — directory listing, file contents, status. */
  output: string;
}

/**
 * Anthropic memory-tool command vocabulary. Field names match the wire format
 * documented for `memory_20250818` so a tool-use bridge can JSON-decode an
 * incoming command into this shape with no rewriting.
 *
 * `view_range` is 1-indexed line numbers `[start, end]` (inclusive); omit to
 * get the whole file (or directory listing for paths that resolve to a dir).
 */
export type MemoryCommand =
  | { command: 'view'; path: string; view_range?: readonly [number, number] }
  | { command: 'create'; path: string; file_text: string }
  | { command: 'str_replace'; path: string; old_str: string; new_str: string }
  | { command: 'insert'; path: string; insert_line: number; insert_text: string }
  | { command: 'delete'; path: string }
  | { command: 'rename'; old_path: string; new_path: string };

/**
 * Storage primitive. Anything that can `read`/`write`/`list`/`delete` flat
 * paths satisfies it — IndexedDB in the browser, an in-memory map in tests,
 * a future filesystem adapter on the server. The encryption layer wraps this
 * (see `crypto.ts`), so secret paths are still stored ciphertext.
 *
 * Paths are opaque strings starting with `/memories/`. Implementations MUST
 * NOT interpret the path beyond exact-match equality and prefix-match for
 * directory listing.
 */
export interface MemoryBackend {
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  delete(path: string): Promise<boolean>;
  /** Return all paths whose string starts with `prefix` (no trailing slash assumed). */
  list(prefix: string): Promise<readonly string[]>;
  /** Move the value at `oldPath` to `newPath`. Throws if `oldPath` is missing. */
  rename(oldPath: string, newPath: string): Promise<void>;
}

/**
 * The three canonical memory file basenames the brain prompt teaches the
 * model to think about. Anything else the model wants to write is allowed
 * (the Anthropic tool surface is open) but the snapshot and the recall
 * harness focus on these three.
 */
export const CORE_MEMORY_FILES = [
  'facts_about_user.md',
  'relationship_state.md',
  'important_events.md',
] as const;

export type CoreMemoryFile = (typeof CORE_MEMORY_FILES)[number];

/**
 * Per-turn memory mutation emitted by the brain envelope when the OpenRouter
 * path is in use. We keep this narrower than the full Anthropic command set
 * because (a) free models reliably emit JSON but unreliably emit the full
 * memory-tool flow with a separate tool-call round-trip, and (b) the recall
 * harness only needs append/replace semantics. A future Claude path uses the
 * full `MemoryCommand` set instead of this shape.
 */
export interface BrainMemoryMutation {
  /** Which canonical file to mutate. Empty string == skip. */
  file: '' | CoreMemoryFile;
  /** "append" adds `content` as a new bullet line; "replace" rewrites the file. */
  op: '' | 'append' | 'replace';
  /** Plain-text content. Markdown bullets handled by the writer. */
  content: string;
  /** When true, encrypt the entry at rest as a persona secret. */
  secret: boolean;
}
