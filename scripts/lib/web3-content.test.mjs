import test from 'node:test';
import assert from 'node:assert/strict';
import { allUrls, sourcePlanErrors, structuralErrors } from './web3-content.mjs';
import { loadContentFiles } from './web3-content.mjs';
import { loadContentFiles as loadDsa } from './dsa-content.mjs';
import { buildRoadmapPolicy } from '../../apps/api/src/learning/roadmap-policy.ts';
import { readFile } from 'node:fs/promises';
import { dependencyErrors, updatePreparedCourse } from './course-content.mjs';

const authored = (await loadContentFiles()).flatMap(({ doc }) => doc.proposedTopics);
const policy = (active = []) =>
  buildRoadmapPolicy(
    authored.map((topic) => ({
      id: topic.title,
      parentId: topic.parentTitle ?? null,
      prerequisiteIds: topic.prerequisiteTitles,
      status: active.includes(topic.title) ? 'active' : 'planned',
    })),
  );

test('curriculum gates preserve depth without requiring unrelated chapters', () => {
  const initial = policy();
  assert.equal(initial.get('Foundry project anatomy').learnable, true);
  assert.equal(
    policy(['Foundry project anatomy']).get('Unit testing with forge-std').learnable,
    false,
  );
  assert.equal(initial.get('Nodes, clients & JSON-RPC').learnable, true);
  assert.equal(initial.get('viem clients: public, wallet & transports').learnable, false);
  assert.equal(
    policy(['Nodes, clients & JSON-RPC', 'Raw Ethereum JSON-RPC']).get(
      'viem clients: public, wallet & transports',
    ).learnable,
    true,
  );
  const amm = 'Constant-product market maker (x*y=k)';
  assert.equal(policy(['ERC-20 fungible token standard']).get(amm).learnable, true);
  assert.equal(initial.get('TWAP oracle manipulation').learnable, false);
  assert.ok(
    initial
      .get('TWAP oracle manipulation')
      .effectivePrerequisiteIds.includes('Uniswap V2 TWAP oracle'),
  );
  assert.equal(policy(['Hashing & Merkle trees']).get('SNARKs vs STARKs').learnable, true);
  assert.equal(
    policy(['ERC-20 fungible token standard']).get('Tokenized treasuries (BUIDL, Ondo)').learnable,
    true,
  );
  for (const [title, state] of initial) {
    assert.equal(state.cycle, false, title);
    assert.equal(state.unavailablePrerequisite, false, title);
    assert.equal(state.malformedParent, false, title);
    for (const pre of state.effectivePrerequisiteIds)
      assert.equal(
        initial.get(pre).kind,
        'leaf',
        `${title} must not require an entire chapter: ${pre}`,
      );
  }
});

test('project catalogue retains every milestone and only references existing lessons', async () => {
  const catalogue = JSON.parse(
    await readFile(new URL('../../content/projects/web3-products.json', import.meta.url)),
  );
  assert.deepEqual(
    catalogue.projects.map((project) => project.id),
    [
      'wallet-console',
      'chain-indexer',
      'escrow-payments',
      'distribution',
      'raffle',
      'marketplace',
      'amm-exchange',
      'lending-vault',
      'treasury-governance',
      'smart-account',
      'cross-chain',
      'capstone',
    ],
  );
  const milestones = catalogue.projects.flatMap((project) => project.milestones);
  assert.equal(milestones.length, 76);
  const titles = new Set(authored.map((topic) => topic.title.toLowerCase()));
  for (const milestone of milestones)
    for (const title of milestone.topicTitles) assert.ok(titles.has(title.toLowerCase()), title);
  assert.match(catalogue.description, /one active product milestone/i);
  assert.ok(catalogue.assessment.some((line) => /decision record/.test(line)));
});

test('all original topics and long lab tasks survive the curriculum revision', async () => {
  const baseline = JSON.parse(
    await readFile(new URL('../../content/course-revisions/2026-09-03.json', import.meta.url)),
  );
  const files = await loadContentFiles();
  const prompts = files.flatMap(({ doc }) => doc.proposedPrompts);
  const byTitle = new Map(authored.map((topic) => [topic.title, topic]));
  assert.equal(authored.filter((topic) => topic.type === 'pattern').length, 365);
  assert.equal(prompts.length, 526);
  for (const topic of baseline.courses.web3.topics)
    assert.ok(byTitle.has(topic.title), topic.title);
  for (const prompt of baseline.courses.web3.prompts.filter((p) => p.estimatedMinutes >= 120)) {
    assert.ok(
      byTitle.get(prompt.topicTitle).aiContext.includes(prompt.promptText),
      prompt.topicTitle,
    );
    assert.ok(
      !prompts.some((p) => p.topicTitle === prompt.topicTitle && p.estimatedMinutes >= 120),
      prompt.topicTitle,
    );
  }
  const dsa = (await loadDsa()).flatMap(({ doc }) => doc.proposedTopics);
  for (const topic of baseline.courses.dsa.topics)
    assert.ok(
      dsa.some((t) => t.title === topic.title),
      topic.title,
    );
  const foundations = dsa.filter((t) => t.parentTitle === 'DSA foundations');
  assert.equal(foundations.length, 5);
  assert.ok(foundations.every((t) => t.sourcePlan?.policy === 'required'));
  assert.ok(
    dsa.find((t) => t.title === 'Data Structures & Algorithms').aiContext.includes('unlabeled'),
  );
});

test('content validation accepts forward references and rejects dangling or inherited cyclic gates', () => {
  const topic = (title, parentTitle = null, prerequisiteTitles = []) => ({
    title,
    parentTitle,
    prerequisiteTitles,
  });
  const files = (topics) =>
    topics.map((t, i) => ({ file: `${i}.json`, doc: { proposedTopics: [t] } }));
  assert.deepEqual(
    dependencyErrors(files([topic('Later-dependent', null, ['Later']), topic('Later')])),
    [],
  );
  assert.match(
    dependencyErrors(files([topic('Leaf', null, ['Missing'])])).join('\n'),
    /missing topic/,
  );
  assert.match(
    dependencyErrors(files([topic('Chapter'), topic('Leaf', 'Chapter', ['Chapter'])])).join('\n'),
    /deadlock/,
  );
  assert.match(
    dependencyErrors(files([topic('A', null, ['B']), topic('B', null, ['A'])])).join('\n'),
    /cyclic/,
  );
  assert.match(dependencyErrors(files([topic('A', 'B'), topic('B', 'A')])).join('\n'), /cyclic/);
});

test('prepared course CLI previews without applying and refuses a mismatched server revision', async () => {
  const requests = [];
  const api = async (path) => {
    requests.push(path);
    return { status: 200, body: { revision: '2026-09-25', fingerprint: 'preview-fingerprint' } };
  };
  await updatePreparedCourse(api, 'web3', { dryRun: true });
  assert.deepEqual(requests, ['/courses/web3/update-preview']);
  await assert.rejects(
    updatePreparedCourse(async () => ({ status: 200, body: { revision: 'old' } }), 'web3'),
    /revision differs/,
  );
});

test('prepared course CLI applies only the fingerprint it previewed and surfaces conflicts', async () => {
  const requests = [];
  const api = async (path, init) => {
    requests.push({ path, init });
    return {
      status: 200,
      body: init ? { topicsUpdated: 1 } : { revision: '2026-09-25', fingerprint: 'checked-state' },
    };
  };
  assert.deepEqual(await updatePreparedCourse(api, 'dsa'), { topicsUpdated: 1 });
  assert.equal(requests[1].path, '/courses/dsa/update');
  assert.deepEqual(JSON.parse(requests[1].init.body), { expectedFingerprint: 'checked-state' });
  await assert.rejects(
    updatePreparedCourse(
      async (_path, init) =>
        init
          ? { status: 409, body: { message: 'Preview again' } }
          : { status: 200, body: { revision: '2026-09-25', fingerprint: 'old-state' } },
      'web3',
    ),
    /409/,
  );
});

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
