import { describe, expect, it } from 'vitest';
import { practiceEventInput } from './practiceEvidence';

describe('recording code practice', () => {
  it('keeps the observed result, version, help and continuation in the existing event contract', () => {
    expect(
      practiceEventInput({
        kind: 'real_debugging',
        description: 'Investigated a failed mutation test.',
        url: 'https://github.com/example/practice/commit/abc123',
        artifact: 'contracts/phase02/Storage.sol at abc123',
        command: 'forge test --match-contract StorageTest',
        result: 'One test still fails; no fix verified.',
        assistance: 'hints',
        nextAction: 'Explain the failing assertion before editing.',
      }),
    ).toEqual({
      kind: 'real_debugging',
      url: 'https://github.com/example/practice/commit/abc123',
      description:
        'Investigated a failed mutation test.\n\nCode / version: contracts/phase02/Storage.sol at abc123\nCheck command: forge test --match-contract StorageTest\nObserved result: One test still fails; no fix verified.\nHelp used: Hints\nNext step: Explain the failing assertion before editing.',
    });
  });

  it('requires actual work, preserves simple records and does not infer independence', () => {
    const draft = {
      kind: 'audit_exercise' as const,
      description: '  Traced the supplied execution.  ',
      url: '',
      artifact: '',
      command: '',
      result: '',
      assistance: '' as const,
      nextAction: '',
    };
    expect(practiceEventInput(draft)).toEqual({
      kind: 'audit_exercise',
      description: 'Traced the supplied execution.',
      url: undefined,
    });
    expect(() =>
      practiceEventInput({ ...draft, description: '', url: 'https://example.com/code' }),
    ).toThrow('Describe');
    expect(() => practiceEventInput({ ...draft, url: 'javascript:alert(1)' })).toThrow('http');
  });
});
