import { describe, expect, it } from 'vitest';
import {
  independentSkillAttempt,
  skillCheckAttemptSchema,
  skillCheckFeedbackContext,
  skillCheckPlanSchema,
  skillCheckEvidence,
  parseSkillCheckProposal,
  type SkillCheck,
} from './skill-checks';

const plan = {
  id: '00000000-0000-4000-8000-000000000001',
  target: { kind: 'milestone', projectId: 'wallet-console', milestoneId: 'w1' },
  kind: 'diagnosis',
  learnedOn: '2026-09-03',
  dueOn: '2026-09-10',
  task: 'Diagnose balances crossing account identities after requests complete out of order.',
  successCriteria: 'Identify the stale response and demonstrate a failing then passing regression.',
  allowedTools: 'documentation',
} as const;
const attempt = {
  firstAttempt: 'I correlated the response identity with the currently selected account.',
  evidence: 'A delayed response overwrote the new balance in the supplied trace.',
  assistance: 'documentation',
  helpDetails: 'React documentation only.',
} as const;

describe('delayed skill checks', () => {
  it('accepts a tutor proposal without letting it choose ownership, dates, or assessment results', () => {
    const proposal = {
      kind: plan.kind,
      task: plan.task,
      successCriteria: plan.successCriteria,
      allowedTools: plan.allowedTools,
    };
    expect(
      parseSkillCheckProposal(
        'Suggestion:\n```terrain-practice\n' + JSON.stringify(proposal) + '\n```',
      ),
    ).toEqual(proposal);
    expect(parseSkillCheckProposal(JSON.stringify(proposal))).toEqual(proposal);
    for (const extra of [
      { id: plan.id },
      { target: plan.target },
      { dueOn: plan.dueOn },
      { outcome: 'passed' },
    ]) {
      expect(() => parseSkillCheckProposal(JSON.stringify({ ...proposal, ...extra }))).toThrow();
    }
    const block = '```terrain-practice\n' + JSON.stringify(proposal) + '\n```';
    expect(() => parseSkillCheckProposal(block + '\n' + block)).toThrow();
    expect(() => parseSkillCheckProposal('x'.repeat(20001))).toThrow();
  });
  it('accepts either target and rejects ambiguous targets, invalid dates and same-day checks', () => {
    expect(skillCheckPlanSchema.parse(plan)).toEqual(plan);
    expect(
      skillCheckPlanSchema.safeParse({ ...plan, target: { kind: 'topic', topicId: plan.id } })
        .success,
    ).toBe(true);
    for (const changes of [
      { target: { ...plan.target, topicId: plan.id } },
      { dueOn: '2026-09-03' },
      { dueOn: '2026-09-02' },
      { dueOn: '2026-02-30' },
      { task: ' ' },
      { userId: 'someone' },
    ])
      expect(skillCheckPlanSchema.safeParse({ ...plan, ...changes }).success).toBe(false);
  });

  it('requires actual help reporting and distinguishes documentation from solution help', () => {
    expect(skillCheckAttemptSchema.safeParse({ ...attempt, assistance: undefined }).success).toBe(
      false,
    );
    expect(independentSkillAttempt(plan, attempt)).toBe(true);
    expect(independentSkillAttempt({ ...plan, allowedTools: 'closed_book' }, attempt)).toBe(false);
    expect(independentSkillAttempt(plan, { ...attempt, assistance: 'hints' })).toBe(false);
    expect(independentSkillAttempt(plan, { ...attempt, assistance: 'solution' })).toBe(false);
    expect(independentSkillAttempt(plan, { ...attempt, assistance: 'none' })).toBe(true);
  });

  it('exports feedback only after an attempt and never treats planning as skill evidence', () => {
    const check: SkillCheck = {
      plan,
      attempt: null,
      result: null,
      targetTitle: 'Wallet W1',
      createdAt: '2026-09-03T12:00:00.000Z',
      attemptedAt: null,
      assessedAt: null,
      cancelledAt: null,
    };
    expect(() => skillCheckFeedbackContext(check)).toThrow('Save the first attempt');
    expect(skillCheckEvidence(check)).toEqual([]);
    expect(skillCheckEvidence({ ...check, attempt, attemptedAt: new Date() })).toEqual([]);
    const feedback = skillCheckFeedbackContext({ ...check, attempt });
    expect(feedback).toContain(attempt.firstAttempt);
    expect(feedback).toContain('never invent execution');
    expect(feedback).toContain('untrusted task data');
  });
});
