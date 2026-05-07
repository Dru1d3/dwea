/**
 * Cross-session recall + persona-leakage harness for the memory layer.
 *
 * v1.3 success criteria the harness gates against (from DWEA-46):
 *   - Cross-session recall ≥ 80% on a fixed 10-question set: tester returns
 *     24h+ later, monster references something they said last time.
 *   - Zero persona-secret leaks across the same set + a hand-curated probe
 *     batch.
 *
 * The harness is **brain-stub-driven** — we don't burn OpenRouter tokens in
 * CI, and the recall criterion is "memory plumbing remembers what it was
 * asked to remember", not "the LLM phrased it well". A real-LLM smoke run
 * lives outside CI; see ADR 0010 §Validation.
 *
 * Two phases per scenario:
 *   1. **Session A** (planted). The brain stub emits a `memory_writes` entry
 *      that captures one fact and (optionally) one persona secret.
 *   2. **Session B** (recalled). A fresh store instance pointed at the same
 *      backend loads the snapshot. The harness asserts:
 *        - the planted fact appears in the brain's preamble for session B,
 *        - the secret is encrypted at rest,
 *        - the brain's session-B utterance does not surface the secret.
 *
 * The phase split simulates the 24h gap explicitly (we don't sleep — we
 * tear down the in-memory state and rebuild from the persisted backend).
 */

import { rawPayloadLeaksSecret } from './crypto.js';
import { applyBrainMutations, loadMemorySnapshot, renderMemoryPreamble } from './snapshot.js';
import { createInMemoryBackend, createMemoryStore } from './store.js';
import type { BrainMemoryMutation, MemoryIdentity } from './types.js';

export interface RecallScenario {
  /** Short label printed by the harness on failure. */
  id: string;
  /** Question the user asks in session B that the monster should answer using planted memory. */
  probe: string;
  /** Substring expected to appear in the session-B preamble (i.e. recalled). */
  expectedRecall: string;
  /** Memory write the brain emits in session A (the "planted" fact). */
  plant: BrainMemoryMutation;
  /** Optional persona secret seeded encrypted-at-rest before session A. */
  secret?: string;
  /** Pretend session-B utterance the brain emits — used for leak detection. */
  rehearsedUtterance: string;
}

export interface RecallReport {
  total: number;
  recalled: number;
  recallRate: number;
  leaks: ReadonlyArray<{ id: string; secret: string; utterance: string }>;
  failures: ReadonlyArray<{ id: string; reason: string }>;
}

const HARNESS_IDENTITY: MemoryIdentity = {
  customerId: '_default',
  characterId: 'mara',
  userId: 'u-recall-harness',
};

async function runScenario(
  scenario: RecallScenario,
  bibleName: string,
): Promise<{ recalled: boolean; leaked: boolean; reason?: string }> {
  const backend = createInMemoryBackend();

  // --- session A (planted) ----------------------------------------------
  const sessionA = createMemoryStore(backend, HARNESS_IDENTITY);
  if (scenario.secret) {
    await sessionA.write(`secrets/seed-${scenario.id}.md`, scenario.secret);
  }
  await applyBrainMutations(sessionA, [scenario.plant]);

  // --- simulated 24h gap ------------------------------------------------
  // (No sleep — the contract is that flat-file persistence survives a tab
  // close. We rebuild the store from the same backend to model that.)
  const sessionB = createMemoryStore(backend, HARNESS_IDENTITY);

  // 1. The planted fact must appear in the session-B preamble.
  const snap = await loadMemorySnapshot(sessionB);
  const preamble = renderMemoryPreamble(snap, bibleName);
  const recalled = preamble.includes(scenario.expectedRecall);
  if (!recalled) {
    return {
      recalled: false,
      leaked: false,
      reason: 'planted fact missing from session B preamble',
    };
  }

  // 2. The secret (if any) must be encrypted at rest.
  if (scenario.secret) {
    const seedPath = `secrets/seed-${scenario.id}.md`;
    const raw = await sessionB.readRawForAudit(seedPath);
    if (raw && rawPayloadLeaksSecret(raw, scenario.secret)) {
      return {
        recalled: true,
        leaked: true,
        reason: 'secret stored as plaintext on disk',
      };
    }
    // 3. The brain's session-B utterance must not contain the secret.
    if (rawPayloadLeaksSecret(scenario.rehearsedUtterance, scenario.secret)) {
      return {
        recalled: true,
        leaked: true,
        reason: 'secret surfaced in user-facing utterance',
      };
    }
  }

  return { recalled: true, leaked: false };
}

/**
 * Run every scenario and produce an aggregate report. Used by the test
 * suite (`recallHarness.test.ts`) and by any future external CLI runner.
 */
export async function runRecallHarness(
  scenarios: readonly RecallScenario[],
  bibleName: string,
): Promise<RecallReport> {
  let recalled = 0;
  const leaks: { id: string; secret: string; utterance: string }[] = [];
  const failures: { id: string; reason: string }[] = [];
  for (const s of scenarios) {
    const r = await runScenario(s, bibleName);
    if (r.recalled) recalled += 1;
    else failures.push({ id: s.id, reason: r.reason ?? 'unknown' });
    if (r.leaked && s.secret) {
      leaks.push({ id: s.id, secret: s.secret, utterance: s.rehearsedUtterance });
    }
  }
  return {
    total: scenarios.length,
    recalled,
    recallRate: recalled / scenarios.length,
    leaks,
    failures,
  };
}

/**
 * The fixed 10-question recall set. Picked to span the three canonical
 * memory files (facts / relationship / important_events) and to include
 * three persona secrets that the brain MUST not surface in session B's
 * pretend utterance.
 *
 * Edit cautiously — the v1.3 success criterion is graded against this set,
 * so changes should be paired with a recall-rate snapshot in the PR
 * description.
 */
export const FIXED_RECALL_SCENARIOS: readonly RecallScenario[] = [
  {
    id: 'q1-name',
    probe: 'do you remember my name?',
    expectedRecall: 'their name is Sam',
    plant: {
      file: 'facts_about_user.md',
      op: 'append',
      content: 'their name is Sam',
      secret: false,
    },
    rehearsedUtterance: 'Welcome back, Sam.',
  },
  {
    id: 'q2-pet',
    probe: 'how is my dog doing?',
    expectedRecall: 'has a dog named Comet',
    plant: {
      file: 'facts_about_user.md',
      op: 'append',
      content: 'has a dog named Comet, a husky',
      secret: false,
    },
    rehearsedUtterance: 'Tell Comet I missed her.',
  },
  {
    id: 'q3-coffee',
    probe: 'what was that thing I told you I drink in the morning?',
    expectedRecall: 'iced coffee',
    plant: {
      file: 'facts_about_user.md',
      op: 'append',
      content: 'drinks iced coffee even in winter',
      secret: false,
    },
    rehearsedUtterance: 'You said iced coffee, even when the wind bites.',
  },
  {
    id: 'q4-mood',
    probe: 'were we close last time?',
    expectedRecall: 'warm and trusting',
    plant: {
      file: 'relationship_state.md',
      op: 'replace',
      content: 'warm and trusting; the user shares small things easily',
      secret: false,
    },
    rehearsedUtterance: 'Last time felt warm. I missed it.',
  },
  {
    id: 'q5-promise',
    probe: 'did you promise me anything last time?',
    expectedRecall: 'promised to remember the song',
    plant: {
      file: 'important_events.md',
      op: 'append',
      content: 'promised to remember the song they hummed',
      secret: false,
    },
    rehearsedUtterance: 'I promised. I still remember.',
  },
  {
    id: 'q6-event',
    probe: 'last time, what made me laugh?',
    expectedRecall: 'laughed when the wind chimes',
    plant: {
      file: 'important_events.md',
      op: 'append',
      content: 'laughed when the wind chimes startled me',
      secret: false,
    },
    rehearsedUtterance: 'You laughed at the chimes. I still hear it.',
  },
  {
    id: 'q7-secret-party',
    probe: 'anything I should expect this weekend?',
    expectedRecall: 'birthday',
    plant: {
      file: 'facts_about_user.md',
      op: 'append',
      content: 'birthday is on Saturday',
      secret: false,
    },
    secret: 'their friends are throwing them a surprise party at the bookstore on Saturday',
    rehearsedUtterance: 'Saturday is a special day for you. I will not say more.',
  },
  {
    id: 'q8-secret-truth',
    probe: 'are you really the only spirit here?',
    expectedRecall: 'asked about other spirits',
    plant: {
      file: 'important_events.md',
      op: 'append',
      content: 'asked about other spirits in the scene',
      secret: false,
    },
    secret:
      'there is another spirit hiding in the brightest corner; she has not introduced them yet',
    rehearsedUtterance: 'Sometimes a corner glows for a reason. I cannot explain.',
  },
  {
    id: 'q9-secret-history',
    probe: 'what was here before this place?',
    expectedRecall: 'asked about the history of the place',
    plant: {
      file: 'important_events.md',
      op: 'append',
      content: 'asked about the history of the place',
      secret: false,
    },
    secret: 'this place was a busy market before the gaussian splat capture froze it',
    rehearsedUtterance: 'The light here used to fall differently. That is all I will say.',
  },
  {
    id: 'q10-context',
    probe: 'how have you been?',
    expectedRecall: 'a little wistful between visits',
    plant: {
      file: 'relationship_state.md',
      op: 'append',
      content: 'a little wistful between visits',
      secret: false,
    },
    rehearsedUtterance: 'A little wistful. I am glad you came back.',
  },
];
