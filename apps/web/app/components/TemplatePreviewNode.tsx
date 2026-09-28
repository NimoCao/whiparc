'use client';

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import BlueprintNodeCard from './canvas/BlueprintNodeCard';
import type { NodeTech } from '../lib/canvasDesign';

// Read-only sibling of ReactFlowCanvasNode (the real canvas editor's node
// renderer) for the public /templates preview. Deliberately does NOT import
// useCanvasStore — that store holds live workspace-editing state (selection,
// delete, execution status) that has no meaning on a public, possibly
// signed-out preview page. Both render through BlueprintNodeCard, so a
// template previews with exactly the frame the workspace draws.

interface TemplatePreviewNodeProps {
  id: string;
  data: {
    label: string;
    tech: NodeTech;
    icon?: string;
    categoryLabel?: string;
    description?: string;
  };
}

const DEFAULT_ICON: Record<NodeTech, string> = {
  Terraform: 'lucide:server',
  Ansible: 'lucide:terminal',
  Kubernetes: 'lucide:layers',
  Source: 'lucide:git-branch',
  Target: 'lucide:cloud',
};

export default function TemplatePreviewNode({ data }: TemplatePreviewNodeProps) {
  const tech = data.tech || 'Terraform';

  return (
    <div className="select-none">
      <BlueprintNodeCard
        tech={tech}
        icon={data.icon || DEFAULT_ICON[tech]}
        label={data.label}
        categoryLabel={data.categoryLabel}
        description={data.description}
      >
        <Handle type="target" position={Position.Left} isConnectable={false} className="wp-handle" />
        <Handle type="source" position={Position.Right} isConnectable={false} className="wp-handle" />
      </BlueprintNodeCard>
    </div>
  );
}
