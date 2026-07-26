import type { TopicStatus } from '@prisma/client';

export type RoadmapNode = {
  id: string;
  parentId: string | null;
  status: TopicStatus;
  prerequisiteIds: string[];
};

export type RoadmapEligibility = {
  kind: 'leaf' | 'group';
  learned: boolean;
  satisfied: boolean;
  learnable: boolean;
  effectivePrerequisiteIds: string[];
  learnedLeaves: number;
  totalLeaves: number;
  unfinishedLeafIds: string[];
  blockerIds: string[];
  unavailablePrerequisite: boolean;
  malformedParent: boolean;
  cycle: boolean;
};

const learned = (status: TopicStatus) => status === 'active' || status === 'mastered';

export function buildRoadmapPolicy(nodes: RoadmapNode[]): Map<string, RoadmapEligibility> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    children.set(node.parentId, [...(children.get(node.parentId) ?? []), node.id]);
  }

  const inheritedConstraints = new Map(
    nodes.map((node) => {
      const prerequisiteIds: string[] = [];
      const seenPrerequisites = new Set<string>();
      const seenParents = new Set<string>();
      let current: RoadmapNode | undefined = node;
      let unavailablePrerequisite = false;
      let malformedParent = false;
      let cycle = false;

      while (current) {
        if (seenParents.has(current.id)) {
          cycle = true;
          break;
        }
        seenParents.add(current.id);
        for (const prerequisiteId of current.prerequisiteIds) {
          if (!byId.has(prerequisiteId)) unavailablePrerequisite = true;
          else if (!seenPrerequisites.has(prerequisiteId)) {
            seenPrerequisites.add(prerequisiteId);
            prerequisiteIds.push(prerequisiteId);
          }
        }
        if (current.parentId === null) break;
        current = byId.get(current.parentId);
        if (!current) malformedParent = true;
      }

      return [
        node.id,
        { prerequisiteIds, unavailablePrerequisite, malformedParent, cycle },
      ] as const;
    }),
  );

  const facts = new Map<string, { leafIds: string[]; satisfied: boolean; cycle: boolean }>();
  const inspect = (
    id: string,
    visiting = new Set<string>(),
  ): { leafIds: string[]; satisfied: boolean; cycle: boolean } => {
    const cached = facts.get(id);
    if (cached) return cached;
    const current = byId.get(id);
    if (!current || visiting.has(id)) return { leafIds: [], satisfied: false, cycle: true };
    const constraints = inheritedConstraints.get(id)!;
    const childIds = children.get(id) ?? [];
    if (childIds.length === 0) {
      const fact = {
        leafIds: [id],
        satisfied:
          learned(current.status) &&
          !constraints.unavailablePrerequisite &&
          !constraints.malformedParent &&
          !constraints.cycle,
        cycle: constraints.cycle,
      };
      facts.set(id, fact);
      return fact;
    }
    const next = new Set(visiting).add(id);
    const childFacts = childIds.map((childId) => inspect(childId, next));
    const leafIds = childFacts.flatMap((fact) => fact.leafIds);
    const cycle = constraints.cycle || childFacts.some((fact) => fact.cycle);
    const fact = {
      leafIds,
      satisfied:
        !cycle &&
        !constraints.unavailablePrerequisite &&
        !constraints.malformedParent &&
        childFacts.every((childFact) => childFact.satisfied),
      cycle,
    };
    facts.set(id, fact);
    return fact;
  };

  for (const node of nodes) inspect(node.id);

  return new Map(
    nodes.map((node) => {
      const fact = inspect(node.id);
      const kind = (children.get(node.id) ?? []).length > 0 ? 'group' : 'leaf';
      const constraints = inheritedConstraints.get(node.id)!;
      const unfinishedLeafIds = fact.leafIds.filter((leafId) => !learned(byId.get(leafId)!.status));
      const blockerIds = constraints.prerequisiteIds.filter(
        (prerequisiteId) => !inspect(prerequisiteId).satisfied,
      );
      return [
        node.id,
        {
          kind,
          learned: learned(node.status),
          satisfied: fact.satisfied,
          learnable:
            node.status === 'planned' &&
            kind === 'leaf' &&
            blockerIds.length === 0 &&
            !constraints.unavailablePrerequisite &&
            !constraints.malformedParent &&
            !fact.cycle,
          effectivePrerequisiteIds: constraints.prerequisiteIds,
          learnedLeaves: fact.leafIds.length - unfinishedLeafIds.length,
          totalLeaves: fact.leafIds.length,
          unfinishedLeafIds,
          blockerIds,
          unavailablePrerequisite: constraints.unavailablePrerequisite,
          malformedParent: constraints.malformedParent,
          cycle: fact.cycle,
        },
      ];
    }),
  );
}
