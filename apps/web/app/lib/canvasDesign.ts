import type { Edge } from '@xyflow/react';

// Shared canvas design vocabulary for the workspace editor and the read-only
// template previews, so a node or connection reads identically in both.

export type NodeTech = 'Terraform' | 'Ansible' | 'Kubernetes' | 'Source' | 'Target';

// Tech -> ink color, straight from the design's node kickers and connectors:
// Terraform reads accent, Ansible amber, targets teal.
export const TECH_COLOR: Record<NodeTech, string> = {
  Terraform: 'var(--accent-ink, #FF8A63)',
  Ansible: 'var(--amber, #F59E0B)',
  Kubernetes: 'var(--k8s-ink, #7DD3FC)',
  Source: 'var(--amber, #F59E0B)',
  Target: 'var(--target-ink, #5EEAD4)',
};

export function techColor(tech: string | undefined): string {
  return TECH_COLOR[tech as NodeTech] ?? TECH_COLOR.Kubernetes;
}

export const DEFAULT_EDGE_WIDTH = 1.5;

// Connector color/thickness are derived from the target node at render time,
// not stored, so every saved project picks up the current theme. The
// inspector can still override either one; an override is marked in
// `edge.data` (customStroke / customWidth) by useCanvasStore.updateEdgeData.
//
// Edges saved before this design carry an auto-assigned stroke (a fixed
// palette color or a gradient url) and a 2.5 width. Those are NOT overrides,
// so they are recognised here and ignored; any other stored color is a
// deliberate pick from the inspector's swatches and is kept.
const LEGACY_AUTO_STROKES = new Set(['#8B5CF6', '#F59E0B', '#14B8A6', '#0EA5E9', '#6366F1', '#FF6A3D']);

type EdgeStyleSource = Pick<Edge, 'style' | 'data'>;

export function edgeCustomStroke(edge: EdgeStyleSource): string | undefined {
  const stroke = edge.style?.stroke;
  if (typeof stroke !== 'string' || !stroke) return undefined;
  if (edge.data?.customStroke) return stroke;
  if (stroke.startsWith('url(') || LEGACY_AUTO_STROKES.has(stroke.toUpperCase())) return undefined;
  return stroke;
}

export function edgeCustomWidth(edge: EdgeStyleSource): number | undefined {
  const width = edge.style?.strokeWidth;
  return edge.data?.customWidth && typeof width === 'number' ? width : undefined;
}

export function edgeStrokeWidth(edge: EdgeStyleSource): number {
  return edgeCustomWidth(edge) ?? DEFAULT_EDGE_WIDTH;
}
