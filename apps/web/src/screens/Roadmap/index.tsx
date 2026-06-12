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
  useTopics,
  useUpdateTopic,
  useDeleteTopic,
  useAddPrerequisite,
  useRemovePrerequisite,
} from '../../api/hooks';
import type { TopicWithMeta } from '../../api/types';
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
import { layoutGraph } from './layout';

const nodeTypes = { topic: TopicNode } as NodeTypes;

const LEGEND: { glyph: string; label: string; color: string }[] = [
  { glyph: STATUS_META.planned.glyph, label: 'Planned', color: STATUS_META.planned.color },
  { glyph: STATUS_META.active.glyph, label: 'Active', color: STATUS_META.active.color },
  { glyph: STATUS_META.mastered.glyph, label: 'Mastered', color: STATUS_META.mastered.color },
  { glyph: '✗', label: 'Blocked', color: BLOCKED_COLOR },
];

export default function Roadmap() {
  const { data: topics, isLoading, isError, error } = useTopics();
  const [domain, setDomain] = useState<string>('__all__');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showParked, setShowParked] = useState(false);

  const { mutate: updateTopic } = useUpdateTopic();
  const { mutate: deleteTopic } = useDeleteTopic();
  const { mutate: addPrerequisite } = useAddPrerequisite();
  const { mutate: removePrerequisite } = useRemovePrerequisite();
  const { toast } = useToast();
  const rf = useRef<ReactFlowInstance<TopicNodeType, Edge> | null>(null);

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

  const { derivedNodes, derivedEdges } = useMemo(() => {
    const all = topics ?? [];
    const filtered = all.filter((t) => {
      if (domain !== '__all__' && t.domain !== domain) return false;
      const parked = t.aiProposed && t.status === 'archived';
      if (t.status === 'archived') return parked && showParked; // parked only, only when toggled
      return true; // active graph (incl. tentative)
    });
    const visible = new Set(filtered.map((t) => t.id));

    const baseNodes: TopicNodeType[] = filtered.map((t: TopicWithMeta) => ({
      id: t.id,
      type: 'topic',
      position: { x: 0, y: 0 },
      data: {
        topic: t,
        selected: t.id === selectedId,
        onKeep: keep,
        onSetAside: setAside,
        onRestore: restore,
        onDelete: removePermanently,
      } satisfies TopicNodeData,
    }));

    const builtEdges: Edge[] = [];
    for (const t of filtered) {
      for (const preId of t.prerequisiteIds) {
        if (!visible.has(preId)) continue;
        builtEdges.push({
          id: `${preId}-${t.id}`,
          source: preId,
          target: t.id,
          data: { kind: 'prereq' },
          markerEnd: { type: MarkerType.ArrowClosed },
        });
      }
      if (t.parentId && visible.has(t.parentId)) {
        builtEdges.push({
          id: `parent-${t.parentId}-${t.id}`,
          source: t.parentId,
          target: t.id,
          data: { kind: 'parent' },
          selectable: false,
          deletable: false,
          animated: true,
          style: { strokeDasharray: '5 5', stroke: 'var(--st-archived)' },
          markerEnd: { type: MarkerType.ArrowClosed },
        });
      }
    }

    // layoutGraph's generic widens Node<_, 'topic'> back to Node<_>; restore the
    // 'topic' discriminant so ReactFlow infers TopicNodeType (matches rf + handlers).
    const laidOut = layoutGraph(baseNodes, builtEdges) as TopicNodeType[];
    return { derivedNodes: laidOut, derivedEdges: builtEdges };
  }, [topics, domain, selectedId, showParked, keep, setAside, restore, removePermanently]);

  // Controlled graph: local node/edge state (so selection + drag reach the React
  // Flow store, enabling the Delete-key → onEdgesDelete path and live drag). The
  // state is SEEDED from the dagre-laid-out derived graph and re-seeded whenever
  // the underlying data changes — positions are never persisted; dagre stays the
  // source of truth and a drag is a gesture that snaps back on the next refresh.
  const [nodes, setNodes, onNodesChange] = useNodesState<TopicNodeType>(derivedNodes);
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

  const onNodeClick: NodeMouseHandler = (_e, node) => {
    setSelectedId(node.id);
  };

  const onNodeDragStop: OnNodeDrag<TopicNodeType> = (_e, node) => {
    const inst = rf.current;
    if (!inst) return;
    const hits = inst.getIntersectingNodes(node).filter((n) => n.id !== node.id);
    if (hits.length > 1) return; // ambiguous — ignore; node snaps back on next layout
    const targetId = hits.length === 1 ? hits[0].id : null;
    if (targetId === (node.data.topic.parentId ?? null)) return; // no structural change
    const title = node.data.topic.title;
    updateTopic(
      { id: node.id, input: { parentId: targetId } },
      {
        onSuccess: () => toast(targetId ? `Moved ${title}` : `Un-parented ${title}`, 'success'),
        onError: (e) => {
          err(e, 'Move rejected');
          resyncFromDerived(); // snap the dragged node back to its layout position
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
          <button className={domain === '__all__' ? 'on' : ''} onClick={() => setDomain('__all__')}>
            All
          </button>
          {domains.map((d) => (
            <button key={d} className={domain === d ? 'on' : ''} onClick={() => setDomain(d)}>
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

      {!hasTopics ? (
        <div style={{ marginTop: 24 }}>
          <EmptyState
            title="No topics yet"
            hint="Add one on the Topics screen, or run an Export and let Claude propose your roadmap."
          />
        </div>
      ) : derivedNodes.length === 0 ? (
        <div style={{ marginTop: 24 }}>
          <EmptyState title="No topics in this domain" hint="Pick a different domain filter." />
        </div>
      ) : (
        <div
          style={{
            height: 'calc(100vh - 120px)',
            width: '100%',
            marginTop: 12,
            border: '1px solid var(--line, #e5e7eb)',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
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
