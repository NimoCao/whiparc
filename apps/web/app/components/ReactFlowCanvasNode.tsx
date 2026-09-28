'use client';

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { Icon } from '@iconify/react';
import useCanvasStore, { NodeExecutionStatus } from '../store/useCanvasStore';
import BlueprintNodeCard, { type NodeTag } from './canvas/BlueprintNodeCard';
import type { NodeTech } from '../lib/canvasDesign';

interface ReactFlowCanvasNodeProps {
  id: string;
  data: {
    label: string;
    tech: NodeTech;
    icon: string;
    categoryLabel: string;
    description: string;
    status: 'Validated' | 'Warning' | 'Editing';
    statusText: string;
    editorName?: string;
    isCustom?: boolean;
  };
  selected?: boolean;
}

const EXEC_STYLE: Record<Exclude<NodeExecutionStatus, 'idle'>, { label: string; color: string; pulse: boolean }> = {
  pending: { label: 'Pending', color: 'var(--ink3)', pulse: false },
  running: { label: 'Running…', color: 'var(--accent-ink)', pulse: true },
  completed: { label: 'Completed', color: 'var(--success, #10B981)', pulse: false },
  failed: { label: 'Failed', color: 'var(--danger, #F43F5E)', pulse: false },
};

// Execution state strip attached to the bottom of the frame.
function ExecutionStatusBar({ status, isDestroy }: { status: NodeExecutionStatus; isDestroy: boolean }) {
  if (status === 'idle') return null;

  const { label, color, pulse } = EXEC_STYLE[status];
  const tint = status === 'running' && isDestroy ? 'var(--danger, #F43F5E)' : color;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 12px',
        borderTop: '1px solid var(--line)',
        background: `color-mix(in srgb, ${tint} 8%, transparent)`,
        color: tint,
        fontFamily: 'var(--font-mono-marketing, ui-monospace, monospace)',
        fontSize: 9,
        letterSpacing: '.1em',
        textTransform: 'uppercase',
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          flexShrink: 0,
          background: 'currentColor',
          animation: pulse ? 'wpNodeBeat 1.4s ease-in-out infinite' : undefined,
        }}
      />
      {label}
    </div>
  );
}

function statusTag(data: ReactFlowCanvasNodeProps['data']): NodeTag | undefined {
  switch (data.status) {
    case 'Validated':
      return { text: data.statusText || data.status, color: 'var(--success, #10B981)' };
    case 'Warning':
      return { text: data.statusText || data.status, color: 'var(--amber)' };
    case 'Editing':
      return {
        text: data.editorName || 'Editing',
        color: 'var(--accent-ink)',
        pulse: true,
        title: `${data.editorName || 'Someone'} editing`,
      };
    default:
      return undefined;
  }
}

export default function ReactFlowCanvasNode({ id, data }: ReactFlowCanvasNodeProps) {
  const { setSelectedNodeId, deleteNode, selectedNodeId, edges, deleteEdge, saveStatus } = useCanvasStore();
  const isExecuting = useCanvasStore((state) => state.isExecuting);
  const execStatus = useCanvasStore((state) => state.executionStatuses[id] ?? 'idle');
  const pipelineAction = useCanvasStore((state) => state.pipelineAction);
  const isReadOnly = isExecuting || saveStatus === 'readonly';

  const incomingEdges = React.useMemo(() => edges.filter((e) => e.target === id), [edges, id]);
  const outgoingEdges = React.useMemo(() => edges.filter((e) => e.source === id), [edges, id]);

  // Zustand selectedNodeId is the single source of truth for the active marker.
  // React Flow's `selected` prop is intentionally ignored here — it reflects internal
  // drag/box-select state and causes double-active badges when dragging new nodes.
  const isActive = selectedNodeId === id;

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isExecuting) return;
    deleteNode(id);
  };

  return (
    // The click is deliberately NOT stopped here: React Flow's node wrapper
    // handles it next (selection state + the workspace's onNodeClick, which
    // clears any selected connection). Swallowing it left a previously
    // selected connection active, so the inspector stayed on the connection.
    <div onClick={() => setSelectedNodeId(id)} className="select-none cursor-pointer">
      <BlueprintNodeCard
        tech={data.tech}
        icon={data.icon}
        label={data.label}
        categoryLabel={data.categoryLabel}
        description={data.description}
        isActive={isActive}
        isCustom={data.isCustom}
        tag={statusTag(data)}
        footer={<ExecutionStatusBar status={execStatus} isDestroy={pipelineAction === 'destroy'} />}
      >
        {/* Handles sit on the frame's left/right border, centered vertically;
            React Flow positions them from its own handle classes. */}
        <Handle type="target" position={Position.Left} className="wp-handle" style={{ zIndex: 30 }} />
        <Handle type="source" position={Position.Right} className="wp-handle" style={{ zIndex: 30 }} />

        {!isReadOnly && incomingEdges.length > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              incomingEdges.forEach((edge) => deleteEdge(edge.id));
            }}
            className="wp-node-action warn"
            style={{ left: 5, top: '50%', transform: 'translateY(-50%)' }}
            title="Clear incoming connection"
            aria-label="Clear incoming connection"
          >
            <Icon icon="lucide:x" width={10} />
          </button>
        )}
        {!isReadOnly && outgoingEdges.length > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              outgoingEdges.forEach((edge) => deleteEdge(edge.id));
            }}
            className="wp-node-action warn"
            style={{ right: 5, top: '50%', transform: 'translateY(-50%)' }}
            title="Clear outgoing connection"
            aria-label="Clear outgoing connection"
          >
            <Icon icon="lucide:x" width={10} />
          </button>
        )}
        {!isExecuting && (
          <button
            type="button"
            onClick={handleDelete}
            className="wp-node-action danger"
            style={{ top: -9, right: 10 }}
            title="Delete Node"
            aria-label="Delete node"
          >
            <Icon icon="lucide:trash-2" width={10} />
          </button>
        )}
      </BlueprintNodeCard>
    </div>
  );
}
