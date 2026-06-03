import { describe, it, expect } from 'vitest';
import { parseLearningOs } from './index';

const validBlock = `Some friendly prose from Claude.

\`\`\`learning-os
{
  "version": 1,
  "sessionId": "abc-123",
  "reviews": [{ "topicTitle": "Monotonic stack", "topicId": null, "quality": 3, "note": "ok" }],
  "proposedTopics": [],
  "noteSummaries": [],
  "nextSession": { "focusTitle": "Increasing variant", "coldChallenge": "LeetCode #84" }
}
\`\`\`

More prose after.`;

describe('parseLearningOs', () => {
  it('extracts and validates the learning-os block, ignoring surrounding prose', () => {
    const out = parseLearningOs(validBlock);
    expect(out.version).toBe(1);
    expect(out.sessionId).toBe('abc-123');
    expect(out.reviews[0].quality).toBe(3);
  });

  it('throws when no learning-os block is present', () => {
    expect(() => parseLearningOs('no block here')).toThrow(/no learning-os block/i);
  });

  it('throws when the JSON is malformed', () => {
    const bad = '```learning-os\n{ not json }\n```';
    expect(() => parseLearningOs(bad)).toThrow();
  });

  it('throws when a required field is missing', () => {
    const missing = '```learning-os\n{ "version": 1 }\n```';
    expect(() => parseLearningOs(missing)).toThrow();
  });

  it('accepts a proposedPrompts array with an optional answerHint', () => {
    const withPrompts = `\`\`\`learning-os
{
  "version": 1,
  "sessionId": "abc-123",
  "reviews": [],
  "proposedTopics": [],
  "proposedPrompts": [
    { "topicTitle": "Monotonic stack", "promptText": "What invariant does the stack maintain?", "answerHint": "Monotonic order" }
  ],
  "noteSummaries": []
}
\`\`\``;
    const out = parseLearningOs(withPrompts);
    expect(out.proposedPrompts).toHaveLength(1);
    expect(out.proposedPrompts[0].answerHint).toBe('Monotonic order');
  });

  it('defaults proposedPrompts to [] when omitted (backward compatible)', () => {
    expect(parseLearningOs(validBlock).proposedPrompts).toEqual([]);
  });

  it('accepts promptKind: "code" on a proposedPrompt', () => {
    const withCodePrompt = `\`\`\`learning-os
{
  "version": 1,
  "sessionId": "abc-123",
  "reviews": [],
  "proposedTopics": [],
  "proposedPrompts": [
    { "topicTitle": "Two pointers", "promptText": "Implement the opposite-direction two-pointer scan.", "promptKind": "code" }
  ],
  "noteSummaries": []
}
\`\`\``;
    const out = parseLearningOs(withCodePrompt);
    expect(out.proposedPrompts[0].promptKind).toBe('code');
  });

  it('defaults promptKind to "concept" when omitted', () => {
    const out = parseLearningOs(validBlock);
    expect(out.proposedPrompts).toEqual([]);
    const withPrompts = `\`\`\`learning-os
{
  "version": 1,
  "sessionId": "abc-123",
  "reviews": [],
  "proposedTopics": [],
  "proposedPrompts": [
    { "topicTitle": "Monotonic stack", "promptText": "What invariant does the stack maintain?" }
  ],
  "noteSummaries": []
}
\`\`\``;
    expect(parseLearningOs(withPrompts).proposedPrompts[0].promptKind).toBe('concept');
  });
});
