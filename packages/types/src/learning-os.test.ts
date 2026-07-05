import { describe, it, expect } from 'vitest';
import { parseLearningOs, LearningOsParseError, learningOsV2Schema } from './index';

const minimalV2 = `\`\`\`learning-os
{
  "version": 2,
  "reviews": [],
  "proposedTopics": [],
  "proposedPrompts": [],
  "noteSummaries": []
}
\`\`\``;

describe('parseLearningOs (v2)', () => {
  it('parses a minimal valid v2 block', () => {
    const out = parseLearningOs(minimalV2);
    expect(out.version).toBe(2);
    expect(out.reviews).toEqual([]);
    expect(out.proposedTopics).toEqual([]);
    expect(out.proposedPrompts).toEqual([]);
    expect(out.noteSummaries).toEqual([]);
  });

  it('review with promptId only is valid', () => {
    const block = `\`\`\`learning-os
{
  "version": 2,
  "reviews": [{ "promptId": "3fa85f64-5717-4562-b3fc-2c963f66afa6", "grade": "good" }],
  "proposedTopics": [],
  "proposedPrompts": [],
  "noteSummaries": []
}
\`\`\``;
    const out = parseLearningOs(block);
    expect(out.reviews).toHaveLength(1);
    expect(out.reviews[0].promptId).toBe('3fa85f64-5717-4562-b3fc-2c963f66afa6');
  });

  it('review with topicTitle only is valid', () => {
    const block = `\`\`\`learning-os
{
  "version": 2,
  "reviews": [{ "topicTitle": "Monotonic stack", "grade": "hard" }],
  "proposedTopics": [],
  "proposedPrompts": [],
  "noteSummaries": []
}
\`\`\``;
    const out = parseLearningOs(block);
    expect(out.reviews).toHaveLength(1);
    expect(out.reviews[0].topicTitle).toBe('Monotonic stack');
  });

  it('review with neither promptId nor topicTitle fails', () => {
    const block = `\`\`\`learning-os
{
  "version": 2,
  "reviews": [{ "grade": "good" }],
  "proposedTopics": [],
  "proposedPrompts": [],
  "noteSummaries": []
}
\`\`\``;
    expect(() => parseLearningOs(block)).toThrow(LearningOsParseError);
    try {
      parseLearningOs(block);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LearningOsParseError);
      expect((err as LearningOsParseError).code).toBe('schema');
    }
  });

  it('rejects version 1 with unsupported-version code', () => {
    const block = `\`\`\`learning-os
{
  "version": 1,
  "sessionId": "abc-123",
  "reviews": [],
  "proposedTopics": [],
  "noteSummaries": []
}
\`\`\``;
    try {
      parseLearningOs(block);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LearningOsParseError);
      expect((err as LearningOsParseError).code).toBe('unsupported-version');
      expect((err as Error).message).toMatch(/unsupported learning-os version 1/i);
      expect((err as Error).message).not.toMatch(/ZodError|"code":/);
    }
  });

  it('rejects unknown top-level keys (strict)', () => {
    const block = `\`\`\`learning-os
{
  "version": 2,
  "reviews": [],
  "proposedTopics": [],
  "proposedPrompts": [],
  "noteSummaries": [],
  "bogusKey": true
}
\`\`\``;
    try {
      parseLearningOs(block);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LearningOsParseError);
      expect((err as LearningOsParseError).code).toBe('schema');
    }
  });

  it('rejects unknown review keys e.g. quality (strict)', () => {
    const block = `\`\`\`learning-os
{
  "version": 2,
  "reviews": [{ "topicTitle": "Monotonic stack", "grade": "good", "quality": 3 }],
  "proposedTopics": [],
  "proposedPrompts": [],
  "noteSummaries": []
}
\`\`\``;
    try {
      parseLearningOs(block);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LearningOsParseError);
      expect((err as LearningOsParseError).code).toBe('schema');
    }
  });

  it('takes the LAST learning-os fence when two are present', () => {
    const block = `\`\`\`learning-os
{
  "version": 2,
  "reviews": [],
  "proposedTopics": [],
  "proposedPrompts": [],
  "noteSummaries": [],
  "sessionId": "first"
}
\`\`\`

Some prose in between.

\`\`\`learning-os
{
  "version": 2,
  "reviews": [],
  "proposedTopics": [],
  "proposedPrompts": [],
  "noteSummaries": [],
  "sessionId": "second"
}
\`\`\``;
    const out = parseLearningOs(block);
    expect(out.sessionId).toBe('second');
  });

  it('proposedPrompts accepts promptKind problem with url/problemDifficulty/estimatedMinutes', () => {
    const block = `\`\`\`learning-os
{
  "version": 2,
  "reviews": [],
  "proposedTopics": [],
  "proposedPrompts": [
    {
      "topicTitle": "Two pointers",
      "promptText": "Solve the opposite-direction two-pointer problem.",
      "promptKind": "problem",
      "url": "https://leetcode.com/problems/two-sum/",
      "problemDifficulty": "medium",
      "estimatedMinutes": 20
    }
  ],
  "noteSummaries": []
}
\`\`\``;
    const out = parseLearningOs(block);
    expect(out.proposedPrompts).toHaveLength(1);
    const prompt = out.proposedPrompts[0];
    expect(prompt.promptKind).toBe('problem');
    expect(prompt.url).toBe('https://leetcode.com/problems/two-sum/');
    expect(prompt.problemDifficulty).toBe('medium');
    expect(prompt.estimatedMinutes).toBe(20);
  });

  it('proposedPrompts rejects estimatedMinutes > 240 and promptText > 2000 chars', () => {
    const tooLongText = 'x'.repeat(2001);
    const blockLongText = `\`\`\`learning-os
{
  "version": 2,
  "reviews": [],
  "proposedTopics": [],
  "proposedPrompts": [
    { "topicTitle": "Two pointers", "promptText": ${JSON.stringify(tooLongText)} }
  ],
  "noteSummaries": []
}
\`\`\``;
    try {
      parseLearningOs(blockLongText);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LearningOsParseError);
      expect((err as LearningOsParseError).code).toBe('schema');
    }

    const blockLongMinutes = `\`\`\`learning-os
{
  "version": 2,
  "reviews": [],
  "proposedTopics": [],
  "proposedPrompts": [
    { "topicTitle": "Two pointers", "promptText": "Explain it.", "estimatedMinutes": 241 }
  ],
  "noteSummaries": []
}
\`\`\``;
    try {
      parseLearningOs(blockLongMinutes);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LearningOsParseError);
      expect((err as LearningOsParseError).code).toBe('schema');
    }
  });
});

describe('studiedTopics', () => {
  const base = { version: 2, sessionId: 'abc' };

  it('accepts studiedTopics as an array of titles', () => {
    const parsed = learningOsV2Schema.parse({
      ...base,
      studiedTopics: ['Prefix sums', 'Two pointers'],
    });
    expect(parsed.studiedTopics).toEqual(['Prefix sums', 'Two pointers']);
  });

  it('is optional — omitting it stays valid and yields undefined', () => {
    const parsed = learningOsV2Schema.parse(base);
    expect(parsed.studiedTopics).toBeUndefined();
  });

  it('rejects empty titles and more than 20 entries', () => {
    expect(learningOsV2Schema.safeParse({ ...base, studiedTopics: [''] }).success).toBe(false);
    expect(
      learningOsV2Schema.safeParse({
        ...base,
        studiedTopics: Array.from({ length: 21 }, (_, i) => `t${i}`),
      }).success,
    ).toBe(false);
  });

  it('still rejects unknown fields (strict)', () => {
    expect(learningOsV2Schema.safeParse({ ...base, bogus: true }).success).toBe(false);
  });
});

describe('applicationEvents (v2)', () => {
  it('defaults to [] when omitted (old blocks still parse)', () => {
    const out = parseLearningOs(minimalV2);
    expect(out.applicationEvents).toEqual([]);
  });

  it('parses a valid application event', () => {
    const block = `\`\`\`learning-os
{
  "version": 2,
  "reviews": [],
  "proposedTopics": [],
  "proposedPrompts": [],
  "noteSummaries": [],
  "applicationEvents": [
    { "topicTitle": "Monotonic stack", "kind": "problem_solved",
      "description": "Solved LC 739 from scratch", "url": "https://leetcode.com/problems/daily-temperatures/" }
  ]
}
\`\`\``;
    const out = parseLearningOs(block);
    expect(out.applicationEvents).toHaveLength(1);
    expect(out.applicationEvents[0].kind).toBe('problem_solved');
    expect(out.applicationEvents[0].topicTitle).toBe('Monotonic stack');
  });

  it('rejects an unknown kind', () => {
    const bad = {
      version: 2,
      reviews: [],
      proposedTopics: [],
      proposedPrompts: [],
      noteSummaries: [],
      applicationEvents: [{ topicTitle: 'X', kind: 'invented', description: 'd' }],
    };
    expect(learningOsV2Schema.safeParse(bad).success).toBe(false);
  });

  it('rejects a missing description', () => {
    const bad = {
      version: 2,
      reviews: [],
      proposedTopics: [],
      proposedPrompts: [],
      noteSummaries: [],
      applicationEvents: [{ topicTitle: 'X', kind: 'problem_solved' }],
    };
    expect(learningOsV2Schema.safeParse(bad).success).toBe(false);
  });

  it('rejects a malformed url', () => {
    const bad = {
      version: 2,
      reviews: [],
      proposedTopics: [],
      proposedPrompts: [],
      noteSummaries: [],
      applicationEvents: [
        { topicTitle: 'X', kind: 'problem_solved', description: 'd', url: 'not-a-url' },
      ],
    };
    expect(learningOsV2Schema.safeParse(bad).success).toBe(false);
  });
});
