'use client';

import React, { type CSSProperties } from 'react';
import { Icon } from '@iconify/react';
import useCanvasStore from '../store/useCanvasStore';

interface LibraryNode {
  id: string;
  tech: 'Terraform' | 'Ansible' | 'Kubernetes' | 'Source' | 'Target';
  icon: string;
  title: string;
  description: string;
  category: string;
  isCustom?: boolean;
  rawCode?: string;
  codeType?: 'tf' | 'yml' | 'yaml';
  parameters?: Record<string, unknown>;
  outputs?: string[];
}

const TECH_COLOR: Record<LibraryNode['tech'], string> = {
  Terraform: 'var(--accent-ink)',
  Ansible: '#C4B5FD',
  Kubernetes: 'var(--k8s-ink, #7DD3FC)',
  Source: 'var(--amber)',
  Target: 'var(--target-ink, #5EEAD4)',
};

interface NodeCardProps {
  node: LibraryNode;
  onAddNode: (node: LibraryNode) => void;
  isReadOnly?: boolean;
}

const labelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-marketing, monospace)',
  fontSize: 9.5,
  letterSpacing: '.12em',
  textTransform: 'uppercase',
  color: 'var(--ink3)',
};

function NodeCard({ node, onAddNode, isReadOnly = false }: NodeCardProps) {
  const onDragStart = (event: React.DragEvent) => {
    if (isReadOnly) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData('application/reactflow-node-id', node.id);
    event.dataTransfer.setData('application/reactflow-node-tech', node.tech);
    event.dataTransfer.setData('application/reactflow-node-icon', node.icon);
    event.dataTransfer.setData('application/reactflow-node-title', node.title);
    event.dataTransfer.setData('application/reactflow-node-description', node.description);
    event.dataTransfer.setData('application/reactflow-node-category', node.category);
    if (node.isCustom) {
      event.dataTransfer.setData('application/reactflow-node-iscustom', 'true');
      event.dataTransfer.setData('application/reactflow-node-rawcode', node.rawCode || '');
      event.dataTransfer.setData('application/reactflow-node-codetype', node.codeType || '');
      event.dataTransfer.setData('application/reactflow-node-parameters', JSON.stringify(node.parameters || {}));
    }
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      onClick={() => !isReadOnly && onAddNode(node)}
      draggable={!isReadOnly}
      onDragStart={onDragStart}
      className={isReadOnly ? undefined : 'wp-ws-nodecard'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '7px 9px',
        border: '1px solid var(--line)',
        fontSize: 12.5,
        color: 'var(--ink)',
        userSelect: 'none',
        opacity: isReadOnly ? 0.4 : 1,
        cursor: isReadOnly ? 'not-allowed' : undefined,
      }}
    >
      <Icon icon={node.icon} width={13} style={{ color: TECH_COLOR[node.tech], flexShrink: 0 }} />
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.title}</span>
    </div>
  );
}

export interface LibraryPanelV2Props {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  techFilter: string;
  onTechFilterSelect: (tech: string) => void;
  libraryNodes: LibraryNode[];
  onAddNode: (node: LibraryNode) => void;
  isReadOnly?: boolean;
  onCreateCustomNode?: () => void;
}

export function LibraryPanelV2({
  searchQuery,
  onSearchChange,
  techFilter,
  onTechFilterSelect,
  libraryNodes,
  onAddNode,
  isReadOnly = false,
  onCreateCustomNode,
}: LibraryPanelV2Props) {
  const customLibraryNodes = useCanvasStore((state) => state.customLibraryNodes);
  const mappedCustomNodes: LibraryNode[] = (customLibraryNodes || []).map((cn) => {
    let parsedMeta: { parameters?: Record<string, unknown> } = {};
    try {
      parsedMeta = JSON.parse(cn.parsed_meta_json || '{}');
    } catch {
      // malformed metadata on an older custom node — fall back to no parameters
    }
    return {
      id: cn.id,
      tech: cn.tech,
      icon: cn.tech === 'Terraform' ? 'devicon:terraform' : cn.tech === 'Ansible' ? 'devicon:ansible' : 'devicon:kubernetes',
      title: cn.title,
      description: cn.description,
      category: cn.category,
      isCustom: true,
      rawCode: cn.raw_code,
      codeType: cn.code_type,
      parameters: parsedMeta.parameters || {},
    };
  });

  const allNodes = [...libraryNodes, ...mappedCustomNodes];
  const filteredNodes = allNodes.filter((node) => {
    const matchesSearch = node.title.toLowerCase().includes(searchQuery.toLowerCase()) || node.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTech = techFilter === 'All' || node.tech === techFilter;
    return matchesSearch && matchesTech;
  });
  const categories = Array.from(new Set(filteredNodes.map((n) => n.category)));

  return (
    <aside style={{ width: 216, flexShrink: 0, borderRight: '1px solid var(--line)', background: 'var(--panel)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: 12, borderBottom: '1px solid var(--line)', display: 'grid', gap: 10 }}>
        {!isReadOnly && onCreateCustomNode && (
          <button
            type="button"
            onClick={onCreateCustomNode}
            className="wp-ws-iconbtn"
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', border: '1px dashed var(--line)', background: 'transparent', fontSize: 12.5, color: 'var(--ink2)', cursor: 'pointer' }}
          >
            <Icon icon="lucide:plus" width={13} />
            Create custom node
            <span
              style={{
                marginLeft: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                fontFamily: 'var(--font-mono-marketing, monospace)',
                fontSize: 9,
                letterSpacing: '.06em',
                padding: '1px 5px',
                border: '1px solid var(--amber)',
                color: 'var(--amber)',
              }}
            >
              <Icon icon="lucide:lock" width={9} />
              PRO
            </span>
          </button>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', height: 32, border: '1px solid var(--line)' }}>
          <Icon icon="lucide:search" width={13} style={{ color: 'var(--ink3)' }} />
          <input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Find a node"
            className="wp-ws-input"
            style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', fontSize: 12.5, color: 'var(--ink)', fontFamily: 'var(--font-body-marketing, inherit)' }}
          />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {['All', 'Target', 'Terraform', 'Ansible', 'Kubernetes'].map((tech) => (
            <button
              key={tech}
              type="button"
              onClick={() => onTechFilterSelect(tech)}
              style={{
                flex: '1 1 auto',
                minWidth: 44,
                padding: '4px 2px',
                border: '1px solid var(--line)',
                fontSize: 10,
                fontFamily: 'var(--font-mono-marketing, monospace)',
                cursor: 'pointer',
                background: techFilter === tech ? 'var(--accent)' : 'transparent',
                color: techFilter === tech ? 'var(--on-accent)' : 'var(--ink2)',
              }}
            >
              {tech === 'All' ? 'All' : tech === 'Terraform' ? 'TF' : tech === 'Ansible' ? 'Ans' : tech === 'Kubernetes' ? 'K8s' : tech === 'Target' ? 'Tgt' : tech}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'grid', gap: 16, alignContent: 'start' }}>
        {categories.map((category) => (
          <div key={category}>
            <p style={{ margin: '0 0 8px', ...labelStyle }}>{category}</p>
            <div style={{ display: 'grid', gap: 6 }}>
              {filteredNodes
                .filter((n) => n.category === category)
                .map((node) => (
                  <NodeCard key={node.id} node={node} onAddNode={onAddNode} isReadOnly={isReadOnly} />
                ))}
            </div>
          </div>
        ))}
        {filteredNodes.length === 0 && <p style={{ textAlign: 'center', padding: '20px 0', fontSize: 12, color: 'var(--ink3)' }}>No matching nodes.</p>}
      </div>
    </aside>
  );
}
