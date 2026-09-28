'use client';

import React from 'react';
import { BaseEdge, getSmoothStepPath, useNodesData, type EdgeProps } from '@xyflow/react';
import { edgeCustomStroke, edgeStrokeWidth, techColor } from '../../lib/canvasDesign';
import './canvas.css';

// Deterministic per-edge suffix so each edge's arrowhead marker gets a unique
// id (edge ids contain dots/colons that are unsafe inside url(#...)).
function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// The design's connector: a straight orthogonal run with square corners and an
// open chevron head, colored by the node it points at (Terraform accent,
// Ansible amber, targets teal). Color and thickness are resolved here rather
// than read from the saved edge, so existing projects pick up the current
// theme; an explicit inspector override (see lib/canvasDesign) still wins.
export default function BlueprintEdge({
  id,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  data,
  selected,
  label,
  interactionWidth,
}: EdgeProps) {
  const targetNode = useNodesData(target);
  const tech = (targetNode?.data as { tech?: string } | undefined)?.tech;

  const edgeShape = { style, data };
  const color = edgeCustomStroke(edgeShape) ?? techColor(tech);
  const width = edgeStrokeWidth(edgeShape);

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 0,
    offset: 24,
  });

  const markerId = `wp-tip-${hashId(id)}`;

  return (
    <>
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M0.5 1.2L9 5L0.5 8.8" fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        </marker>
      </defs>
      <path d={path} className="wp-edge-halo" data-selected={!!selected} stroke={color} strokeWidth={width + 6} />
      <BaseEdge
        id={id}
        path={path}
        className="wp-edge-line"
        style={{ stroke: color, strokeWidth: width }}
        markerEnd={`url(#${markerId})`}
        label={label}
        labelX={labelX}
        labelY={labelY}
        labelShowBg
        labelBgPadding={[8, 4]}
        interactionWidth={interactionWidth}
      />
    </>
  );
}
