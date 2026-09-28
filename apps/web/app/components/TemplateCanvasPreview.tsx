'use client';

import { useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import TemplatePreviewNode from './TemplatePreviewNode';
import BlueprintEdge from './canvas/BlueprintEdge';

interface TemplateCanvasPreviewProps {
  nodes: Node[];
  edges: Edge[];
  viewport?: { x: number; y: number; zoom: number };
  // false = a static "poster" render for a catalog card body: no pan, no
  // scroll-zoom, no controls. Cards sit in a scrollable grid, so a card-level
  // preview that captures the mouse wheel (like the full detail view
  // deliberately does) would make scrolling the grid itself feel broken.
  interactive?: boolean;
}

function PreviewInner({ nodes, edges, viewport, interactive = true }: TemplateCanvasPreviewProps) {
  const nodeTypes = useMemo(() => ({ customNode: TemplatePreviewNode }), []);
  // Connector color is derived from each edge's target node at render time
  // (BlueprintEdge), so stored/seed edges_json needs no baked-in styling.
  const edgeTypes = useMemo(() => ({ default: BlueprintEdge }), []);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      defaultViewport={viewport}
      fitView={!viewport}
      fitViewOptions={{ padding: 0.25 }}
      minZoom={0.3}
      maxZoom={1.5}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      panOnDrag={interactive}
      zoomOnScroll={interactive}
      zoomOnPinch={interactive}
      zoomOnDoubleClick={false}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} className="opacity-40" />
      {interactive && <Controls showInteractive={false} />}
    </ReactFlow>
  );
}

export function TemplateCanvasPreview({ nodes, edges, viewport, interactive = true }: TemplateCanvasPreviewProps) {
  if (!nodes.length) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">
        No canvas preview available for this template.
      </div>
    );
  }
  return (
    <ReactFlowProvider>
      {/* Non-interactive mode is wrapped pointer-events-none as a second,
          belt-and-suspenders guard beyond the pan/zoom props above: a card
          sits in a scrollable grid, and nothing about its embedded preview
          should be able to swallow a hover, click, or wheel event meant for
          the page or the card's own "View Template" link. */}
      <div className={interactive ? 'h-full w-full' : 'h-full w-full pointer-events-none'}>
        <PreviewInner nodes={nodes} edges={edges} viewport={viewport} interactive={interactive} />
      </div>
    </ReactFlowProvider>
  );
}
