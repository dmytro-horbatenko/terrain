import test from 'node:test';
import assert from 'node:assert/strict';
import { importedCardCountError, importedWeb3Errors } from './import-web3.mjs';

const sourcePlan = {
  policy: 'required',
  requirements: [
    {
      id: 'protocol-semantics',
      purpose: 'Verify the exact protocol semantics',
      requiredWhen: 'first_exposure',
      options: [
        {
          id: 'official-spec',
          title: 'Official specification',
          url: 'https://example.com/spec',
          format: 'specification',
          scope: 'Section 2',
          estimatedMinutes: 10,
          why: 'Defines the normative behavior and its edge cases precisely.',
        },
      ],
    },
  ],
};

const expected = [
  { title: 'Web3 root', domain: 'Web3', type: 'concept' },
  { title: 'Signing', domain: 'Web3', type: 'pattern', sourcePlan },
];

test('accepts content-equal plans and ignores topics outside Web3', () => {
  const actual = [
    { title: ' Web3 root ', domain: 'Web3', sourcePlan: null },
    { title: 'SIGNING', domain: 'Web3', sourcePlan: structuredClone(sourcePlan) },
    { title: 'Signing', domain: 'DSA', sourcePlan: null },
    { title: 'Unrelated', domain: 'Other', sourcePlan: null },
  ];

  assert.deepEqual(importedWeb3Errors(expected, actual), []);
});

test('reports missing, extra, and duplicate normalized Web3 titles', () => {
  const duplicateExpected = [
    expected[0],
    expected[1],
    { ...expected[1], title: ' SIGNING ' },
    { ...expected[1], title: 'Missing prepared' },
    { title: 'Noise', domain: 'DSA', type: 'pattern' },
  ];
  const actual = [
    { title: 'Web3 root', domain: 'Web3' },
    { title: 'Signing', domain: 'Web3', sourcePlan: structuredClone(sourcePlan) },
    { title: 'Extra topic', domain: 'Web3' },
    { title: ' extra TOPIC ', domain: 'Web3' },
    { title: 'Missing prepared', domain: 'DSA' },
  ];

  assert.deepEqual(importedWeb3Errors(duplicateExpected, actual), [
    'duplicate prepared Web3 title "signing" (2 rows)',
    'duplicate imported Web3 title "extra topic" (2 rows)',
    'missing Web3 topic "Missing prepared"',
    'extra Web3 topic "Extra topic"',
  ]);
});

test('checks card counts from a fetched topic detail', () => {
  assert.equal(importedCardCountError('Signing', 2, { prompts: [{}, {}] }), null);
  assert.equal(
    importedCardCountError('Signing', 2, { prompts: [{}] }),
    '"Signing": 1 cards, expected 2',
  );
});

test('requires every expected pattern topic to have its exact prepared source plan', () => {
  const missing = [
    { title: 'Web3 root', domain: 'Web3' },
    { title: 'Signing', domain: 'Web3', sourcePlan: null },
  ];
  assert.match(importedWeb3Errors(expected, missing).join('\n'), /"Signing".*no sourcePlan/);

  const mismatched = structuredClone(missing);
  mismatched[1].sourcePlan = structuredClone(sourcePlan);
  mismatched[1].sourcePlan.requirements[0].options[0].estimatedMinutes = 11;
  assert.match(
    importedWeb3Errors(expected, mismatched).join('\n'),
    /"Signing".*sourcePlan does not match prepared content/,
  );
});

test('does not require source-plan equality for concept topics', () => {
  const actual = [
    { title: 'Web3 root', domain: 'Web3', sourcePlan: { legacy: true } },
    { title: 'Signing', domain: 'Web3', sourcePlan: structuredClone(sourcePlan) },
  ];

  assert.deepEqual(importedWeb3Errors(expected, actual), []);
});
