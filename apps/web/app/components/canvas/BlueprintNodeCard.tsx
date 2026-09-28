import type { ReactNode } from 'react';
import { Icon } from '@iconify/react';
import { techColor } from '../../lib/canvasDesign';
import '../ui/blueprint.css';
import './canvas.css';

// The design's canvas node: a square, hairline-framed "blueprint object" with
// "+" registration marks, a mono kicker (icon + resource type in the tech's
// color) over a display-font title. Purely presentational so the live editor
// node (ReactFlowCanvasNode) and the read-only template preview node share one
// look without the preview pulling in the editing store.

export const NODE_WIDTH = 176;

export type NodeTag = {
  text: string;
  color: string;
  pulse?: boolean;
  title?: string;
};

interface BlueprintNodeCardProps {
  // Defaults to the workspace node width; the landing page passes a fluid one.
  width?: number | string;
  tech: string | undefined;
  icon: string;
  label: string;
  categoryLabel?: string;
  // Shown as a native tooltip: the mock's node face is kicker + title only.
  description?: string;
  isActive?: boolean;
  isCustom?: boolean;
  tag?: NodeTag;
  // Strip attached under the body (execution state).
  footer?: ReactNode;
  // Handles and hover actions, positioned against the frame.
  children?: ReactNode;
}

export default function BlueprintNodeCard({
  width = NODE_WIDTH,
  tech,
  icon,
  label,
  categoryLabel,
  description,
  isActive = false,
  isCustom = false,
  tag,
  footer,
  children,
}: BlueprintNodeCardProps) {
  const color = techColor(tech);

  return (
    <div
      className="wp-blueprint wp-node"
      data-active={isActive}
      title={description || undefined}
      style={{
        width,
        background: 'var(--panel)',
        // Selection is the border in the tech color plus an inset ring, which
        // reads as the mock's 2px border without shifting the layout.
        borderColor: isActive ? color : 'var(--line)',
        boxShadow: isActive
          ? `inset 0 0 0 1px ${color}, 0 8px 24px -10px color-mix(in srgb, ${color} 45%, transparent)`
          : undefined,
        color,
        transition: 'border-color .15s ease, box-shadow .15s ease',
      }}
    >
      <i className="wp-corner tl" />
      <i className="wp-corner tr" />
      <i className="wp-corner bl" />
      <i className="wp-corner br" />

      {tag && (
        <span
          className="wp-node-tag"
          title={tag.title}
          style={{
            position: 'absolute',
            top: -9,
            left: 10,
            zIndex: 30,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '1px 6px',
            background: 'var(--panel)',
            border: `1px solid ${tag.color}`,
            color: tag.color,
            fontFamily: 'var(--font-mono-marketing, ui-monospace, monospace)',
            fontSize: 8.5,
            letterSpacing: '.06em',
            whiteSpace: 'nowrap',
          }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              background: 'currentColor',
              animation: tag.pulse ? 'wpNodeBeat 2.2s ease-in-out infinite' : undefined,
            }}
          />
          {tag.text}
        </span>
      )}

      <div style={{ minHeight: 62, padding: '9px 12px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 6,
            fontFamily: 'var(--font-mono-marketing, ui-monospace, monospace)',
            fontSize: 9,
            letterSpacing: '.1em',
            textTransform: 'uppercase',
            color,
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <Icon icon={icon} width={11} style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{categoryLabel}</span>
          </span>
          {isCustom && (
            <span style={{ flexShrink: 0, padding: '0 4px', border: '1px solid currentColor', fontSize: 8, letterSpacing: '.06em' }}>custom</span>
          )}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-display, inherit)',
            fontWeight: 600,
            fontSize: 14,
            lineHeight: 1.25,
            color: 'var(--ink)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </div>
      </div>

      {footer}
      {children}
    </div>
  );
}
