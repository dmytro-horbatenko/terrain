import { OUTPUT_CONTRACT } from './output-contract';

describe('OUTPUT_CONTRACT', () => {
  it('documents proposedPrompts and the atomic-prompt rule', () => {
    expect(OUTPUT_CONTRACT).toContain('proposedPrompts');
    expect(OUTPUT_CONTRACT).toContain('one fact');
  });

  it('documents promptKind', () => {
    expect(OUTPUT_CONTRACT).toContain('promptKind');
  });
});
