'use client';

import type { Edge } from '@xyflow/react';
import { Icon } from '@iconify/react';
import { edgeCustomStroke, edgeStrokeWidth } from '../../lib/canvasDesign';

// Inspector form for a selected connection. Field, label and input classes
// match the node parameter forms it sits beside (rendered inside the
// workspace's wp-legacy-token-scope), so the two read as one panel; the
// checkbox, slider, swatches and danger action use the blueprint styles from
// workspace.css (.wp-ws-check / .wp-ws-range / .wp-ws-swatch / .wp-ws-danger).

const LABEL_CLASS = 'block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5';

// '' means "Auto": the connector takes its color from the node it points at.
// The rest are explicit overrides stored on the edge.
const SWATCHES = [
  { name: 'Orange', hex: '#FF6A3D' },
  { name: 'Violet', hex: '#8B5CF6' },
  { name: 'Amber', hex: '#F59E0B' },
  { name: 'Teal', hex: '#14B8A6' },
  { name: 'Sky', hex: '#0EA5E9' },
  { name: 'Emerald', hex: '#10B981' },
  { name: 'Rose', hex: '#F43F5E' },
  { name: 'Gray', hex: '#64748B' },
];

interface EdgeInspectorProps {
  edge: Edge;
  onUpdate: (edgeId: string, label: string, animated: boolean, stroke: string, strokeWidth: number) => void;
  onDelete: (edgeId: string) => void;
}

export default function EdgeInspector({ edge, onUpdate, onDelete }: EdgeInspectorProps) {
  const label = typeof edge.label === 'string' ? edge.label : '';
  const animated = edge.animated || false;
  // '' = auto (derived from the target node); see lib/canvasDesign.
  const stroke = edgeCustomStroke(edge) ?? '';
  const width = edgeStrokeWidth(edge);

  const update = (next: Partial<{ label: string; animated: boolean; stroke: string; width: number }>) =>
    onUpdate(edge.id, next.label ?? label, next.animated ?? animated, next.stroke ?? stroke, next.width ?? width);

  return (
    <div className="space-y-3.5 animate-in fade-in duration-200">
      <div>
        <label className={LABEL_CLASS} htmlFor="wp-edge-label">
          Link Label
        </label>
        <input
          id="wp-edge-label"
          type="text"
          value={label}
          onChange={(e) => update({ label: e.target.value })}
          placeholder="e.g. Web Traffic"
          className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
        />
      </div>

      <label className="flex items-center justify-between gap-3 p-2.5 border border-border cursor-pointer select-none">
        <span className="flex flex-col">
          <span className="text-xs font-semibold text-foreground">Animate Flow Dash</span>
          <span className="text-[10px] text-muted-foreground mt-0.5">Show animated pulse lines along the connection</span>
        </span>
        <input type="checkbox" checked={animated} onChange={(e) => update({ animated: e.target.checked })} className="wp-ws-check" />
      </label>

      <div>
        <div className="flex justify-between items-center mb-1.5">
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider" htmlFor="wp-edge-width">
            Thickness (Width)
          </label>
          <span className="text-[11px] font-mono text-muted-foreground">{width}px</span>
        </div>
        <input
          id="wp-edge-width"
          type="range"
          min="1"
          max="8"
          step="0.5"
          value={width}
          onChange={(e) => update({ width: parseFloat(e.target.value) })}
          className="wp-ws-range"
        />
      </div>

      <div>
        <p className={LABEL_CLASS}>Link Color</p>
        <div className="flex flex-wrap gap-2 items-center">
          <button
            type="button"
            onClick={() => update({ stroke: '' })}
            data-active={stroke === ''}
            className="wp-ws-swatch wp-ws-swatch-auto"
            title="Auto — match the node this connection points at"
            aria-label="Auto color"
            aria-pressed={stroke === ''}
          >
            Auto
          </button>
          {SWATCHES.map((c) => (
            <button
              key={c.hex}
              type="button"
              onClick={() => update({ stroke: c.hex })}
              data-active={stroke.toUpperCase() === c.hex}
              className="wp-ws-swatch"
              style={{ backgroundColor: c.hex }}
              title={c.name}
              aria-label={c.name}
              aria-pressed={stroke.toUpperCase() === c.hex}
            />
          ))}
        </div>
      </div>

      <div className="pt-1">
        <button
          type="button"
          onClick={() => {
            if (confirm('Are you sure you want to delete this connection link?')) {
              onDelete(edge.id);
            }
          }}
          className="wp-ws-danger w-full flex items-center justify-center gap-2 py-2.5 text-xs font-semibold cursor-pointer"
        >
          <Icon icon="lucide:trash-2" width={13} />
          Delete Connection
        </button>
      </div>
    </div>
  );
}
