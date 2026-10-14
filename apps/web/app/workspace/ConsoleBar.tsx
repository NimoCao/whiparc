'use client';

import React, { type RefObject } from 'react';
import { Icon } from '@iconify/react';

const STATUS_COLOR: Record<string, string> = {
  PENDING: 'var(--amber)',
  RUNNING: 'var(--accent-ink)',
  CLEANUP: 'var(--accent-ink)',
  SUCCESS: 'var(--success, #10B981)',
  FAILED: 'var(--danger)',
};

// Standard log-viewer convention (VS Code's terminal, GitHub Actions, Vercel
// deploy logs, etc.): dim the repeated timestamp so it recedes, and reserve
// full-contrast/accent color for what actually varies line to line — here
// the leading `[timestamp]` runner output already has in indigo, plus a
// severity color for lines that clearly are an error/warning, so failures
// don't require reading every line to spot.
const TIMESTAMP_RE = /^(\[\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\])(.*)$/;
const ERROR_LINE_RE = /\[error\]|error:|failed=[1-9]|"unreachable":\s*true|exit code [1-9]/i;
const WARN_LINE_RE = /\[warn(?:ing)?\]|unreachable=[1-9]/i;

function renderLogLine(line: string, key: number) {
  const match = TIMESTAMP_RE.exec(line);
  const messageColor = ERROR_LINE_RE.test(line) ? 'var(--danger)' : WARN_LINE_RE.test(line) ? 'var(--amber)' : 'var(--ink2)';

  if (!match) {
    return (
      <div key={key} style={{ color: messageColor }}>
        {line || ' '}
      </div>
    );
  }

  const [, timestamp, rest] = match;
  return (
    <div key={key}>
      <span style={{ color: 'var(--accent-ink)' }}>{timestamp}</span>
      <span style={{ color: messageColor }}>{rest}</span>
    </div>
  );
}

export interface ConsoleBarProps {
  isOpen: boolean;
  onToggle: () => void;
  logs: string;
  onClearLogs: () => void;
  deployStatus: string;
  terminalEndRef: RefObject<HTMLDivElement | null>;
}

// A persistent full-width bottom strip (matches the design's always-docked
// "console" bar) that expands into the real runner-output log drawer —
// same `logs`/`deployStatus` state the app already streams over the
// deploy WebSocket, just no longer hidden until the header button is
// clicked.
export function ConsoleBar({ isOpen, onToggle, logs, onClearLogs, deployStatus, terminalEndRef }: ConsoleBarProps) {
  return (
    <div data-tour="console" style={{ flexShrink: 0, borderTop: '1px solid var(--line)', background: 'var(--panel)' }}>
      <button
        type="button"
        onClick={onToggle}
        className="wp-ws-console-toggle"
        style={{ height: 34, width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', background: 'transparent', border: 0, cursor: 'pointer', textAlign: 'left' }}
      >
        <Icon icon={isOpen ? 'lucide:chevron-down' : 'lucide:chevron-up'} width={12} style={{ color: 'var(--ink3)' }} />
        <span style={{ fontFamily: 'var(--font-mono-marketing, monospace)', fontSize: 11, color: 'var(--ink2)' }}>console</span>
        <span
          style={{
            marginLeft: 'auto',
            fontFamily: 'var(--font-mono-marketing, monospace)',
            fontSize: 11,
            color: deployStatus === 'IDLE' ? 'var(--ink3)' : STATUS_COLOR[deployStatus] || 'var(--ink3)',
          }}
        >
          {deployStatus === 'IDLE' ? 'idle — press Deploy to run the pipeline' : deployStatus === 'CLEANUP' ? 'cleaning up' : deployStatus.toLowerCase()}
        </span>
      </button>

      {isOpen && (
        <div style={{ height: 240, display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--line)' }}>
          <div style={{ height: 32, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px', borderBottom: '1px solid var(--line)' }}>
            <span style={{ fontFamily: 'var(--font-mono-marketing, monospace)', fontSize: 10.5, color: 'var(--ink2)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon icon="lucide:terminal" width={11} style={{ color: 'var(--accent-ink)' }} />
              Runner output log
            </span>
            <button
              type="button"
              onClick={onClearLogs}
              className="wp-ws-navlink"
              style={{ marginLeft: 'auto', background: 'none', border: 0, color: 'var(--ink2)', fontSize: 10.5, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <Icon icon="lucide:trash-2" width={10} />
              Clear
            </button>
          </div>
          <div style={{ flex: 1, padding: 12, overflowY: 'auto', fontFamily: 'var(--font-mono-marketing, monospace)', fontSize: 11, lineHeight: 1.6, color: 'var(--ink2)' }}>
            <div style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {logs ? logs.split('\n').map(renderLogLine) : 'No active pipeline logs. Press "Deploy" to run visual orchestration…'}
            </div>
            <div ref={terminalEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}
