import { describe, expect, it } from 'vitest';
import {
  parseProjectCheckpoint,
  projectSessionContext,
  validateProjectCheckpoint,
  latestProjectCheckpoint,
  type ProductCurriculum,
  type ProjectCheckpointInput,
} from './projects';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const catalog = JSON.parse(
  readFileSync(resolve(root, 'content/projects/web3-products.json'), 'utf8'),
) as ProductCurriculum;
const project = catalog.projects[0];
const milestone = project.milestones[0];
const draft: ProjectCheckpointInput = {
  id: '9ddc8b31-8d49-4aad-b6ac-887095d3bb88',
  curriculumVersion: catalog.version,
  projectId: project.id,
  milestoneId: milestone.id,
  expectedRevision: 0,
  status: 'active',
  repositoryUrl: '',
  notes: '',
  evidence: '',
  reflection: '',
  nextAction: 'Implement the stale-response experiment',
  assistance: 'hints',
  checkedCriteria: [],
};

describe('product curriculum and checkpoint contract', () => {
  it('resumes the most recently saved project independently of catalog and response order', () => {
    const older = { ...draft, createdAt: '2026-09-03T10:00:00.000Z' };
    const latest = { ...draft, projectId: 'escrow', createdAt: '2026-09-04T10:00:00.000Z' };
    const progress = [
      { projectId: project.id, revision: 1, repositoryUrl: '', checkpoints: [older] },
      { projectId: 'escrow', revision: 1, repositoryUrl: '', checkpoints: [latest] },
    ];
    expect(latestProjectCheckpoint(progress)).toEqual(latest);
    expect(latestProjectCheckpoint([])).toBeUndefined();
    expect(progress[0].checkpoints).toEqual([older]);
  });
  it('has complete, linked milestones and a forward-only suggested project sequence', () => {
    const titles = new Set(
      readdirSync(resolve(root, 'content/web3'))
        .filter((f) => f.endsWith('.json'))
        .flatMap((f) => {
          const doc = JSON.parse(readFileSync(resolve(root, 'content/web3', f), 'utf8'));
          return (doc.proposedTopics ?? []).map((t: { title: string }) => t.title);
        }),
    );
    const ids = new Set<string>();
    const allMilestones = new Set<string>();
    expect(catalog.projects).toHaveLength(12);
    for (const p of catalog.projects) {
      expect(ids.has(p.id)).toBe(false);
      for (const dependency of p.prerequisites) expect(ids.has(dependency), dependency).toBe(true);
      ids.add(p.id);
      expect(p.milestones.length).toBeGreaterThanOrEqual(6);
      expect(p.sources.length).toBeGreaterThanOrEqual(2);
      for (const s of p.sources) expect(new URL(s.url).protocol).toBe('https:');
      for (const m of p.milestones) {
        expect(allMilestones.has(m.id)).toBe(false);
        allMilestones.add(m.id);
        expect(m.hours[0]).toBeGreaterThan(0);
        expect(m.hours[1]).toBeGreaterThanOrEqual(m.hours[0]);
        expect(m.deliverables.length).toBeGreaterThanOrEqual(2);
        expect(m.criteria.length).toBeGreaterThanOrEqual(3);
        expect(new Set(m.criteria.map((c) => c.id)).size).toBe(m.criteria.length);
        for (const text of [m.objective, m.designQuestion, m.failureDrill, m.defense])
          expect(text.length).toBeGreaterThan(35);
        for (const title of m.topicTitles)
          expect(titles.has(title), `${m.id}: ${title}`).toBe(true);
      }
    }
    expect(allMilestones.size).toBe(76);
  });

  it('accepts resumable partial work without manufactured completion evidence', () => {
    expect(validateProjectCheckpoint(draft, catalog)).toEqual(draft);
    expect(() => validateProjectCheckpoint({ ...draft, nextAction: ' ' }, catalog)).toThrow();
  });

  it('requires real criteria, evidence and defense for a completion claim', () => {
    const complete = {
      ...draft,
      status: 'completed',
      evidence: 'Executed the out-of-order response test; the address remained correct.',
      reflection:
        'The query identity binds address and chain so cached balances cannot cross those boundaries.',
      checkedCriteria: milestone.criteria.map((c) => c.id),
    };
    expect(validateProjectCheckpoint(complete, catalog).status).toBe('completed');
    for (const bad of [
      { checkedCriteria: [] },
      { evidence: '' },
      { reflection: '' },
      { checkedCriteria: ['invented'] },
      { repositoryUrl: 'javascript:alert(1)' },
      { checkedCriteria: [...complete.checkedCriteria, complete.checkedCriteria[0]] },
    ]) {
      expect(() => validateProjectCheckpoint({ ...complete, ...bad }, catalog)).toThrow();
    }
  });

  it('rejects stale catalog, unknown identity and unrelated study fields', () => {
    for (const bad of [
      { curriculumVersion: 'old' },
      { projectId: 'other' },
      { milestoneId: 'r1' },
      { studiedTopics: ['fake'] },
      { expectedRevision: -1 },
    ]) {
      expect(() => validateProjectCheckpoint({ ...draft, ...bad }, catalog)).toThrow();
    }
  });

  it('round-trips the AI session snapshot without changing identity or progress', () => {
    const text = projectSessionContext(catalog, project, milestone, draft);
    expect(validateProjectCheckpoint(parseProjectCheckpoint(text), catalog)).toEqual(draft);
    expect(text).toContain('keep status active');
    expect(text).toContain('Keep unrelated topic-study continuation untouched');
    expect(text).toContain(catalog.assessment[catalog.assessment.length - 1]);
    expect(() => parseProjectCheckpoint(text + text)).toThrow('one terrain-project block');
  });
});
