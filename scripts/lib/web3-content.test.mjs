import test from 'node:test';
import assert from 'node:assert/strict';
import { allUrls, sourcePlanErrors, structuralErrors } from './web3-content.mjs';

const valid = {
  title: 'Test leaf',
  type: 'pattern',
  sourcePlan: {
    policy: 'required',
    requirements: [
      {
        id: 'canonical',
        purpose: 'Verify the exact protocol semantics',
        requiredWhen: 'first_exposure',
        options: [
          {
            id: 'official',
            title: 'Official docs',
            url: 'https://example.com/docs',
            format: 'documentation',
            scope: 'Section 2',
            estimatedMinutes: 10,
            why: 'Defines the normative behavior and edge cases',
          },
        ],
      },
    ],
  },
};

const cloneValid = () => structuredClone(valid);

test('requires explicit source policy on Web3 leaves', () => {
  assert.deepEqual(sourcePlanErrors(valid, '01.json'), []);
  assert.match(sourcePlanErrors({ ...valid, sourcePlan: undefined }, '01.json')[0], /sourcePlan/);
});

test('source plans apply only to pattern topics', () => {
  assert.deepEqual(sourcePlanErrors({ title: 'Chapter', type: 'concept' }, '01.json'), []);
});

test('policy none requires a concrete trimmed rationale', () => {
  const topic = cloneValid();
  topic.sourcePlan = {
    policy: 'none',
    rationale: 'This practice leaf is fully self-contained by design.',
  };
  assert.deepEqual(sourcePlanErrors(topic, '01.json'), []);

  topic.sourcePlan.rationale = '   Too short   ';
  assert.match(sourcePlanErrors(topic, '01.json').join('\n'), /rationale.*30/i);
});

test('requires unique requirement ids', () => {
  const topic = cloneValid();
  topic.sourcePlan.requirements.push(structuredClone(topic.sourcePlan.requirements[0]));
  assert.match(sourcePlanErrors(topic, '01.json').join('\n'), /requirement id.*unique/i);
});

test('requires option ids to be unique across required and optional sources', () => {
  const requiredDuplicate = cloneValid();
  const secondRequirement = structuredClone(requiredDuplicate.sourcePlan.requirements[0]);
  secondRequirement.id = 'secondary';
  requiredDuplicate.sourcePlan.requirements.push(secondRequirement);
  assert.match(sourcePlanErrors(requiredDuplicate, '01.json').join('\n'), /option id.*unique/i);

  const optionalDuplicate = cloneValid();
  optionalDuplicate.sourcePlan.optional = [
    structuredClone(optionalDuplicate.sourcePlan.requirements[0].options[0]),
  ];
  assert.match(sourcePlanErrors(optionalDuplicate, '01.json').join('\n'), /option id.*unique/i);
});

test('requires every source requirement to offer an option', () => {
  const topic = cloneValid();
  topic.sourcePlan.requirements[0].options = [];
  assert.match(sourcePlanErrors(topic, '01.json').join('\n'), /at least one option/i);
});

test('requires HTTP or HTTPS source URLs', () => {
  const topic = cloneValid();
  topic.sourcePlan.requirements[0].options[0].url = 'ftp://example.com/docs';
  assert.match(sourcePlanErrors(topic, '01.json').join('\n'), /HTTP\(S\)/);
});

test('accepts only named bounded source scopes', () => {
  for (const scope of [
    'Section 2.1',
    'Chapter Gas accounting',
    'Lesson 4',
    'Part II',
    'Pages 12-18',
    '§ 4.2',
    '12:30-18:45',
    'Entire article (12 min)',
    'Entire page (8 min)',
    'Entire README (15 min)',
    'Entire EIP-1559 (20 min)',
    'Entire ERC-20 (18 min)',
  ]) {
    const topic = cloneValid();
    topic.sourcePlan.requirements[0].options[0].scope = scope;
    assert.deepEqual(sourcePlanErrors(topic, '01.json'), [], scope);
  }

  for (const scope of [
    'Docs',
    'Homepage',
    'Entire site',
    'Whole document',
    'Section',
    'Pages 12',
    'Entire article',
  ]) {
    const topic = cloneValid();
    topic.sourcePlan.requirements[0].options[0].scope = scope;
    assert.match(sourcePlanErrors(topic, '01.json').join('\n'), /bounded scope/i, scope);
  }
});

test('requires specific purpose and why text', () => {
  const topic = cloneValid();
  topic.sourcePlan.requirements[0].purpose = 'Canonical reference';
  topic.sourcePlan.requirements[0].options[0].why = 'Canonical reference';
  const errors = sourcePlanErrors(topic, '01.json').join('\n');
  assert.match(errors, /purpose.*20/i);
  assert.match(errors, /why.*30/i);
});

test('requires freshness fields to appear together', () => {
  for (const freshness of [{ verifiedAt: '2026-07-11' }, { recheckAfterDays: 30 }]) {
    const topic = cloneValid();
    Object.assign(topic.sourcePlan.requirements[0].options[0], freshness);
    assert.match(sourcePlanErrors(topic, '01.json').join('\n'), /freshness fields.*together/i);
  }
});

test('source prefixes scope only source migration checks', () => {
  const files = [
    {
      file: '01-test.json',
      doc: {
        proposedTopics: [
          {
            title: 'Chapter',
            type: 'concept',
            domain: 'Web3',
            description: 'Context. Resources: https://legacy.example.com',
            prerequisiteTitles: [],
          },
          {
            title: 'Leaf',
            type: 'pattern',
            domain: 'Web3',
            description: 'A source-free practice leaf.',
            prerequisiteTitles: [],
            parentTitle: 'Chapter',
            aiContext: 'Build: a small example. Done when: its behavior is demonstrated.',
          },
        ],
        proposedPrompts: [
          {
            topicTitle: 'Leaf',
            promptText: 'Explain it.',
            promptKind: 'concept',
          },
        ],
      },
    },
  ];

  assert.deepEqual(structuralErrors(files, { sourcePrefixes: ['02', '03'] }), []);
  const unscoped = structuralErrors(files).join('\n');
  assert.match(unscoped, /Chapter.*Resources:/);
  assert.match(unscoped, /Leaf.*sourcePlan/);
});

test('source prefixes do not scope existing structural checks', () => {
  const files = [
    {
      file: '01-test.json',
      doc: {
        proposedTopics: [
          {
            title: 'Wrong domain',
            type: 'concept',
            domain: 'Other',
            prerequisiteTitles: [],
          },
        ],
        proposedPrompts: [],
      },
    },
  ];

  assert.match(structuralErrors(files, { sourcePrefixes: ['02'] }).join('\n'), /must be Web3/);
});

test('allUrls enumerates source plans and problem cards, not descriptions', () => {
  const topic = cloneValid();
  topic.description = 'Legacy Resources: https://legacy.example.com';
  topic.sourcePlan.optional = [
    {
      ...structuredClone(topic.sourcePlan.requirements[0].options[0]),
      id: 'optional',
      title: 'Optional article',
      url: 'http://example.com/optional',
    },
  ];
  const files = [
    {
      file: '01-test.json',
      doc: {
        proposedTopics: [topic],
        proposedPrompts: [
          {
            topicTitle: topic.title,
            promptKind: 'problem',
            url: 'https://example.com/problem',
          },
        ],
      },
    },
  ];

  assert.deepEqual(allUrls(files), [
    {
      file: '01-test.json',
      where: 'topic "Test leaf" source "official"',
      url: 'https://example.com/docs',
    },
    {
      file: '01-test.json',
      where: 'topic "Test leaf" optional source "optional"',
      url: 'http://example.com/optional',
    },
    {
      file: '01-test.json',
      where: 'card on "Test leaf"',
      url: 'https://example.com/problem',
    },
  ]);
});
