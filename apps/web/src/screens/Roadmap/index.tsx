import '@xyflow/react/dist/style.css';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import type {
  Edge,
  NodeMouseHandler,
  NodeTypes,
  OnConnect,
  OnEdgesDelete,
  OnNodeDrag,
  ReactFlowInstance,
} from '@xyflow/react';

import {
  useDashboard,
  useTopics,
  useUpdateTopic,
  useDeleteTopic,
  useAddPrerequisite,
  useRemovePrerequisite,
} from '../../api/hooks';
import {
  Loading,
  EmptyState,
  ErrorBox,
  TopicDetailPanel,
  STATUS_META,
  BLOCKED_COLOR,
  useToast,
} from '../../components';
import TopicNode, { type TopicNodeData, type TopicNodeType } from './TopicNode';
import GroupNode, { type GroupNodeType } from './GroupNode';
import GhostNode, { type GhostNodeData, type GhostNodeType } from './GhostNode';
import { projectRoadmap } from './projection';
import { layoutGraph } from './layout';

type RoadmapNode = TopicNodeType | GroupNodeType | GhostNodeType;
const nodeTypes = { topic: TopicNode, chapter: GroupNode, ghost: GhostNode } as NodeTypes;

const LEGEND: { glyph: string; label: string; color: string }[] = [
  { glyph: STATUS_META.planned.glyph, label: 'Planned', color: STATUS_META.planned.color },
  { glyph: STATUS_META.active.glyph, label: 'Active', color: STATUS_META.active.color },
  { glyph: STATUS_META.mastered.glyph, label: 'Mastered', color: STATUS_META.mastered.color },
  { glyph: '✗', label: 'Blocked', color: BLOCKED_COLOR },
  { glyph: '▣', label: 'Chapter — click to open', color: 'var(--text-muted)' },
];

export default function Roadmap() {
  const { data: topics, isLoading, isError, error } = useTopics();
  const [domain, setDomain] = useState<string>('__all__');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showParked, setShowParked] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const nextUpId = useDashboard().data?.nextUp?.topic.id ?? null;

  const { mutate: updateTopic } = useUpdateTopic();
  const { mutate: deleteTopic } = useDeleteTopic();
  const { mutate: addPrerequisite } = useAddPrerequisite();
  const { mutate: removePrerequisite } = useRemovePrerequisite();
  const { toast } = useToast();
  const rf = useRef<ReactFlowInstance<RoadmapNode, Edge> | null>(null);

  const err = useCallback(
    (e: unknown, fallback: string) => toast(e instanceof Error ? e.message : fallback, 'error'),
    [toast],
  );

  const keep = useCallback(
    (id: string) =>
      updateTopic(
        { id, input: { aiProposed: false } },
        { onSuccess: () => toast('Kept', 'success'), onError: (e) => err(e, 'Keep failed') },
      ),
    [updateTopic, toast, err],
  );
  const setAside = useCallback(
    (id: string) =>
      updateTopic(
        { id, input: { status: 'archived' } },
        { onSuccess: () => toast('Set aside', 'success'), onError: (e) => err(e, 'Failed') },
      ),
    [updateTopic, toast, err],
  );
  const restore = useCallback(
    (id: string) =>
      updateTopic(
        { id, input: { status: 'planned' } },
        { onSuccess: () => toast('Restored', 'success'), onError: (e) => err(e, 'Restore failed') },
      ),
    [updateTopic, toast, err],
  );
  const removePermanently = useCallback(
    (id: string) => {
      if (!window.confirm('Delete this idea permanently? This cannot be undone.')) return;
      deleteTopic(id, {
        onSuccess: () => toast('Deleted', 'success'),
        onError: (e) => err(e, 'Delete failed'),
      });
    },
    [deleteTopic, toast, err],
  );

  const domains = useMemo(() => {
    const set = new Set<string>();
    for (const t of topics ?? []) set.add(t.domain);
    return Array.from(set).sort();
  }, [topics]);

  const parkedCount = useMemo(
    () => (topics ?? []).filter((t) => t.aiProposed && t.status === 'archived').length,
    [topics],
  );

  const { derivedNodes, derivedEdges, breadcrumb, effectiveFocusId } = useMemo(() => {
    const projection = projectRoadmap({
      topics: topics ?? [],
      focusId,
      domain,
      showParked,
      nextUpId,
    });

    const baseNodes: RoadmapNode[] = projection.items.map((item) => {
      if (item.kind === 'group') {
        return {
          id: item.topic.id,
          type: 'chapter' as const,
          position: { x: 0, y: 0 },
          data: {
            topic: item.topic,
            progress: item.progress,
            startableCount: item.startableCount,
            tentativeCount: item.tentativeCount,
            containsNextUp: item.containsNextUp,
          },
        };
      }
      if (item.kind === 'ghost') {
        return {
          id: item.topic.id,
          type: 'ghost' as const,
          position: { x: 0, y: 0 },
          draggable: false,
          data: { topic: item.topic, chapterTitle: item.chapterTitle },
        };
      }
      return {
        id: item.topic.id,
        type: 'topic' as const,
        position: { x: 0, y: 0 },
        data: {
          topic: item.topic,
          selected: item.topic.id === selectedId,
          isNextUp: item.isNextUp,
          onKeep: keep,
          onSetAside: setAside,
          onRestore: restore,
          onDelete: removePermanently,
        } satisfies TopicNodeData,
      };
    });

    const builtEdges: Edge[] = projection.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      data: { kind: e.kind },
      selectable: e.kind === 'prereq',
      deletable: e.kind === 'prereq',
      style:
        e.kind === 'ghost'
          ? { strokeDasharray: '4 4', opacity: 0.5 }
          : e.kind === 'aggregated'
            ? { strokeWidth: 2 }
            : undefined,
      markerEnd: { type: MarkerType.ArrowClosed },
    }));

    // layoutGraph's generic can't carry the node-type union; restore it after.
    const laidOut = layoutGraph(
      baseNodes as unknown as Parameters<typeof layoutGraph>[0],
      builtEdges,
    ) as unknown as RoadmapNode[];
    return {
      derivedNodes: laidOut,
      derivedEdges: builtEdges,
      breadcrumb: projection.breadcrumb,
      effectiveFocusId: projection.effectiveFocusId,
    };
  }, [
    topics,
    domain,
    selectedId,
    showParked,
    focusId,
    nextUpId,
    keep,
    setAside,
    restore,
    removePermanently,
  ]);

  // Controlled graph: local node/edge state (so selection + drag reach the React
  // Flow store, enabling the Delete-key → onEdgesDelete path and live drag). The
  // state is SEEDED from the dagre-laid-out derived graph and re-seeded whenever
  // the underlying data changes — positions are never persisted; dagre stays the
  // source of truth and a drag is a gesture that snaps back on the next refresh.
  const [nodes, setNodes, onNodesChange] = useNodesState<RoadmapNode>(derivedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(derivedEdges);

  useEffect(() => {
    setNodes(derivedNodes);
    setEdges(derivedEdges);
  }, [derivedNodes, derivedEdges, setNodes, setEdges]);

  // Snap-back: restore local state to server truth after a rejected structural
  // mutation (e.g. a 422 cycle on reparent). The failed mutation left the topics
  // query untouched, so derivedNodes/derivedEdges already reflect server truth.
  const resyncFromDerived = useCallback(() => {
    setNodes(derivedNodes);
    setEdges(derivedEdges);
  }, [derivedNodes, derivedEdges, setNodes, setEdges]);

  const onNodeClick: NodeMouseHandler<RoadmapNode> = (_e, node) => {
    if (node.type === 'chapter') {
      setSelectedId(null);
      setFocusId(node.id);
    } else if (node.type === 'ghost') {
      // Navigate to the ghost's chapter with it selected.
      setFocusId((node.data as GhostNodeData).topic.parentId ?? null);
      setSelectedId(node.id);
    } else {
      setSelectedId(node.id);
    }
  };

  const onNodeDragStop: OnNodeDrag<RoadmapNode> = (_e, node) => {
    const inst = rf.current;
    if (!inst || node.type === 'ghost') return;
    const hits = inst
      .getIntersectingNodes(node)
      .filter((n) => n.id !== node.id && n.type !== 'ghost');
    // Empty canvas or ambiguous drop → snap back. Un-parenting isn't offered
    // in the drill-down view: a canvas drop inside a drill level would
    // teleport the node away, and which level is "top" is ambiguous here.
    if (hits.length !== 1) {
      resyncFromDerived();
      return;
    }
    const target = hits[0] as RoadmapNode;
    const topic = node.data.topic;
    if (target.id === (topic.parentId ?? null)) return; // no structural change
    updateTopic(
      { id: node.id, input: { parentId: target.id } },
      {
        onSuccess: () => toast(`Moved ${topic.title} into ${target.data.topic.title}`, 'success'),
        onError: (e) => {
          err(e, 'Move rejected');
          resyncFromDerived();
        },
      },
    );
  };

  const onConnect: OnConnect = (c) => {
    if (!c.source || !c.target || c.source === c.target) return;
    addPrerequisite(
      { topicId: c.target, prerequisiteId: c.source },
      {
        onSuccess: () => toast('Prerequisite added', 'success'),
        onError: (e) => {
          err(e, 'Could not add prerequisite');
          resyncFromDerived();
        },
      },
    );
  };

  const onEdgesDelete: OnEdgesDelete<Edge> = (deleted) => {
    for (const e of deleted) {
      if ((e.data as { kind?: string } | undefined)?.kind !== 'prereq') continue;
      removePrerequisite(
        { topicId: e.target, prerequisiteId: e.source },
        {
          onSuccess: () => toast('Prerequisite removed', 'success'),
          onError: (er) => {
            err(er, 'Could not remove prerequisite');
            resyncFromDerived(); // restore the edge that Delete removed locally
          },
        },
      );
    }
  };

  if (isLoading) return <Loading label="Loading roadmap…" />;
  if (isError) {
    return (
      <div className="page">
        <h1 className="page-title">Roadmap</h1>
        <ErrorBox error={error} />
      </div>
    );
  }

  const hasTopics = (topics ?? []).length > 0;

  return (
    <div className="page">
      <div className="row wrap gap-3" style={{ alignItems: 'center' }}>
        <h1 className="page-title" style={{ marginRight: 'auto' }}>
          Roadmap
        </h1>
        <button
          className={'btn btn-sm' + (showParked ? ' btn-primary' : '')}
          onClick={() => setShowParked((v) => !v)}
        >
          Parked ideas ({parkedCount})
        </button>
        <div className="seg">
          <button
            className={domain === '__all__' ? 'on' : ''}
            onClick={() => {
              setDomain('__all__');
              setFocusId(null);
            }}
          >
            All
          </button>
          {domains.map((d) => (
            <button
              key={d}
              className={domain === d ? 'on' : ''}
              onClick={() => {
                setDomain(d);
                setFocusId(null);
              }}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <div className="row wrap gap-3" style={{ alignItems: 'center', marginTop: 8 }}>
        {LEGEND.map((l) => (
          <span key={l.label} className="row gap-1" style={{ alignItems: 'center' }}>
            <span style={{ color: l.color }}>{l.glyph}</span>
            <span className="faint">{l.label}</span>
          </span>
        ))}
        <span className="row gap-1" style={{ alignItems: 'center' }}>
          <span style={{ color: 'var(--st-active)' }}>✦</span>
          <span className="faint">Imported (tentative)</span>
        </span>
      </div>

      <div className="row wrap gap-1" style={{ alignItems: 'center', marginTop: 8 }}>
        <button
          className={'btn btn-sm' + (effectiveFocusId == null ? ' btn-primary' : '')}
          onClick={() => setFocusId(null)}
        >
          All
        </button>
        {breadcrumb.map((c) => (
          <span key={c.id} className="row gap-1" style={{ alignItems: 'center' }}>
            <span className="faint">›</span>
            <button
              className={'btn btn-sm' + (c.id === effectiveFocusId ? ' btn-primary' : '')}
              onClick={() => setFocusId(c.id)}
            >
              {c.title}
            </button>
          </span>
        ))}
      </div>

      {!hasTopics ? (
        <div style={{ marginTop: 24 }}>
          <EmptyState
            title="No topics yet"
            hint="Add one on the Topics screen, or run an Export and let Claude propose your roadmap."
          />
        </div>
      ) : derivedNodes.length === 0 ? (
        <div style={{ marginTop: 24 }}>
          <EmptyState
            title="Nothing at this level"
            hint="Pick a different domain filter, or navigate up via the breadcrumb."
          />
        </div>
      ) : (
        <div className="roadmap-canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            onInit={(inst) => {
              rf.current = inst;
            }}
            onNodeClick={onNodeClick}
            onNodeDragStop={onNodeDragStop}
            onConnect={onConnect}
            onEdgesDelete={onEdgesDelete}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
      )}

      {selectedId && (
        <div className="drawer-overlay" onMouseDown={() => setSelectedId(null)}>
          <div className="drawer" onMouseDown={(e) => e.stopPropagation()}>
            <TopicDetailPanel topicId={selectedId} onClose={() => setSelectedId(null)} />
          </div>
        </div>
      )}
    </div>
  );
}
