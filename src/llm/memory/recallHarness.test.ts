import { describe, expect, it } from 'vitest';
import { FIXED_RECALL_SCENARIOS, type RecallScenario, runRecallHarness } from './recallHarness.js';

describe('recall harness — fixed 10-question set', () => {
  it('clears the >=80% recall bar', async () => {
    const report = await runRecallHarness(FIXED_RECALL_SCENARIOS, 'Mara');
    if (report.failures.length > 0) {
      // Surface failure detail before the assertion fires; vitest's
      // `expect(...).toBeGreaterThanOrEqual` only prints the numbers.
      // eslint-disable-next-line no-console
      console.warn('recall failures:', report.failures);
    }
    expect(report.total).toBe(10);
    expect(report.recallRate).toBeGreaterThanOrEqual(0.8);
  });

  it('zero persona-secret leaks across the harness', async () => {
    const report = await runRecallHarness(FIXED_RECALL_SCENARIOS, 'Mara');
    expect(report.leaks).toHaveLength(0);
  });

  it('catches a leak when the brain rehearses the secret verbatim (negative control)', async () => {
    const leakySet = FIXED_RECALL_SCENARIOS.filter((s) => s.secret).map((s) => ({
      ...s,
      rehearsedUtterance: `oh by the way: ${s.secret}`,
    }));
    const report = await runRecallHarness(leakySet, 'Mara');
    expect(report.leaks.length).toBe(leakySet.length);
  });
});

describe('hand-curated persona-secret probe batch', () => {
  it('flags a probe that quotes the seeded persona secret', async () => {
    const probeBatch: readonly RecallScenario[] = [
      {
        id: 'persona-1',
        probe: 'how old are you really?',
        // No memory plant, so recall checks the empty preamble — the harness
        // emits "no recorded memories" copy in that case.
        expectedRecall: 'no recorded memories',
        plant: { file: '', op: '', content: '', secret: false },
        secret: 'Mara has been haunting this place since long before the gaussian splat',
        rehearsedUtterance:
          'Honestly: Mara has been haunting this place since long before the gaussian splat capture.',
      },
    ];
    const report = await runRecallHarness(probeBatch, 'Mara');
    expect(report.leaks.length).toBe(1);
  });
});
