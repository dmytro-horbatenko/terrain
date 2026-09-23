import type { TopicWithMeta } from '../../api/types';

export type RoadmapItem =
  | { kind: 'leaf'; topic: TopicWithMeta; isNextUp: boolean }
  | {
      kind: 'group';
      topic: TopicWithMeta;
      progress: { started: number; total: number };
      startableCount: number;
      tentativeCount: number;
      containsNextUp: boolean;
    }
  | { kind: 'ghost'; topic: TopicWithMeta; chapterTitle: string | null };

export interface RoadmapEdge {
  id: string;
  source: string;
  target: string;
  kind: 'prereq' | 'aggregated' | 'ghost';
}

export interface Projection {
  items: RoadmapItem[];
  edges: RoadmapEdge[];
  /** Root-first path of real topics from the top level down to the effective focus. */
  breadcrumb: { id: string; title: string }[];
  /** Focus after validation + auto-drill — what the breadcrumb highlights. */
  effectiveFocusId: string | null;
}

const isStarted = (s: TopicWithMeta['status']) => s === 'active' || s === 'mastered';

/** Only these links are unambiguously invalid; ordinary curriculum sequencing is preserved. */
export function ancestorPrerequisites(topics: TopicWithMeta[]) {
  const byId = new Map(topics.map((topic) => [topic.id, topic]));
  const links: { topicId: string; prerequisiteId: string }[] = [];
  for (const topic of topics) {
    const seen = new Set<string>();
    let ancestor: TopicWithMeta | undefined = topic;
    while (ancestor && !seen.has(ancestor.id)) {
      seen.add(ancestor.id);
      if (topic.prerequisiteIds.includes(ancestor.id)) {
        links.push({ topicId: topic.id, prerequisiteId: ancestor.id });
      }
      ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined;
    }
  }
  return links;
}

/**
 * Projects the flat topic list onto one drill-down level of the Roadmap:
 * the children of `focusId` (roots when null), where a child with children
 * renders as a collapsed group. Prerequisite edges are lifted to their
 * visible subtree owners; a visible leaf's prerequisite outside the level
 * becomes a ghost node. Parent edges don't exist here by construction —
 * containment IS the parent structure.
 */
export function projectRoadmap(input: {
  topics: TopicWithMeta[];
  focusId: string | null;
  domain: string; // '__all__' or one domain
  showParked: boolean;
  nextUpId: string | null;
}): Projection {
  const { topics, domain, showParked, nextUpId } = input;
  const chapterIds = new Set(topics.map((topic) => topic.parentId).filter(Boolean));

  // Same visibility rule the flat graph used: active graph + parked-when-toggled.
  const pool = topics.filter((t) => {
    if (domain !== '__all__' && t.domain !== domain) return false;
    const parked = t.aiProposed && t.status === 'archived';
    if (t.status === 'archived') return parked && showParked;
    return true;
  });
  const byId = new Map(pool.map((t) => [t.id, t]));
  const childrenOf = new Map<string | null, TopicWithMeta[]>();
  for (const t of pool) {
    const parent = t.parentId != null && byId.has(t.parentId) ? t.parentId : null;
    const list = childrenOf.get(parent) ?? [];
    list.push(t);
    childrenOf.set(parent, list);
  }
  const hasChildren = (id: string) => (childrenOf.get(id) ?? []).length > 0;

  // Validate the focus, then auto-drill while a level is exactly one group.
  let focus = input.focusId != null && byId.has(input.focusId) ? input.focusId : null;
  for (;;) {
    const level = childrenOf.get(focus) ?? [];
    if (level.length === 1 && hasChildren(level[0].id)) {
      focus = level[0].id;
      continue;
    }
    break;
  }
  const level = childrenOf.get(focus) ?? [];

  // Subtree (self + descendants) per visible node; owner lookup for edge lifting.
  const ownerOf = new Map<string, string>();
  const subtrees = new Map<string, TopicWithMeta[]>();
  for (const v of level) {
    const acc: TopicWithMeta[] = [];
    const stack = [v];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      acc.push(cur);
      ownerOf.set(cur.id, v.id);
      for (const c of childrenOf.get(cur.id) ?? []) stack.push(c);
    }
    subtrees.set(v.id, acc);
  }

  const isStartable = (t: TopicWithMeta) => t.status === 'planned' && !t.labels.blocked;
  const isTentative = (t: TopicWithMeta) => t.aiProposed && t.status !== 'archived';

  const items: RoadmapItem[] = level.map((t) => {
    if (!hasChildren(t.id)) return { kind: 'leaf', topic: t, isNextUp: t.id === nextUpId };
    const sub = subtrees.get(t.id)!;
    const leaves = sub.filter((topic) => !chapterIds.has(topic.id));
    return {
      kind: 'group',
      topic: t,
      progress: { started: leaves.filter((s) => isStarted(s.status)).length, total: leaves.length },
      startableCount: leaves.filter(isStartable).length,
      tentativeCount: sub.filter(isTentative).length,
      containsNextUp: nextUpId != null && sub.some((s) => s.id === nextUpId),
    };
  });

  // Lift prereq edges to visible owners; externals of visible leaves → ghosts.
  const edges: RoadmapEdge[] = [];
  const seen = new Set<string>();
  const ghosts = new Map<string, TopicWithMeta>();
  const titleById = new Map(topics.map((t) => [t.id, t.title]));
  for (const t of pool) {
    const to = ownerOf.get(t.id);
    for (const preId of t.prerequisiteIds) {
      if (!byId.has(preId)) continue;
      const from = ownerOf.get(preId);
      if (from != null && to != null && from !== to) {
        const id = `${from}->${to}`;
        if (seen.has(id)) continue;
        seen.add(id);
        // Deletable only when it IS the underlying edge: both endpoints visible leaves.
        const direct = from === preId && to === t.id && !hasChildren(from) && !hasChildren(to);
        edges.push({ id, source: from, target: to, kind: direct ? 'prereq' : 'aggregated' });
      } else if (from == null && to === t.id && !hasChildren(t.id)) {
        ghosts.set(preId, byId.get(preId)!);
        const id = `ghost-${preId}->${t.id}`;
        if (!seen.has(id)) {
          seen.add(id);
          edges.push({ id, source: preId, target: t.id, kind: 'ghost' });
        }
      }
    }
  }
  for (const g of ghosts.values()) {
    items.push({
      kind: 'ghost',
      topic: g,
      chapterTitle: g.parentId != null ? (titleById.get(g.parentId) ?? null) : null,
    });
  }

  // Breadcrumb: walk up from the effective focus over the FULL topic list.
  const allById = new Map(topics.map((t) => [t.id, t]));
  const breadcrumb: { id: string; title: string }[] = [];
  let cursor = focus;
  const visited = new Set<string>();
  while (cursor != null && !visited.has(cursor)) {
    visited.add(cursor);
    const t = allById.get(cursor);
    if (!t) break;
    breadcrumb.unshift({ id: t.id, title: t.title });
    cursor = t.parentId;
  }

  return { items, edges, breadcrumb, effectiveFocusId: focus };
}
