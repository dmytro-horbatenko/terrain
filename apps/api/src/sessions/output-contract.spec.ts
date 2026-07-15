import { OUTPUT_CONTRACT } from './output-contract';

describe('OUTPUT_CONTRACT', () => {
  it('documents proposedPrompts and the atomic-prompt rule', () => {
    expect(OUTPUT_CONTRACT).toContain('proposedPrompts');
    expect(OUTPUT_CONTRACT).toContain('one fact');
  });

  it('documents promptKind', () => {
    expect(OUTPUT_CONTRACT).toContain('promptKind');
  });

  it('is the v2 contract (version 2, grade, promptId reviews)', () => {
    expect(OUTPUT_CONTRACT).toContain('"version": 2');
    expect(OUTPUT_CONTRACT).toContain('grade');
    expect(OUTPUT_CONTRACT).toContain('promptId');
  });

  it('documents the applicationEvents array', () => {
    expect(OUTPUT_CONTRACT).toContain('applicationEvents');
    expect(OUTPUT_CONTRACT).toContain('problem_solved');
  });

  it('documents curated, substitute, and expired source evidence', () => {
    expect(OUTPUT_CONTRACT).toContain('"sourceEvidence"');
    expect(OUTPUT_CONTRACT).toContain('substitutionReason');
    expect(OUTPUT_CONTRACT).toContain('verifiedLiveAt');
    expect(OUTPUT_CONTRACT).toContain('reconstructed');
  });

  it('keeps the grade-is-the-users-verdict rule', () => {
    expect(OUTPUT_CONTRACT).toContain('never yours');
  });

  it('tells Claude to keep noteSummaries terse and point to external notes', () => {
    expect(OUTPUT_CONTRACT.toLowerCase()).toContain('brief');
    expect(OUTPUT_CONTRACT).toContain('Obsidian');
  });
});
