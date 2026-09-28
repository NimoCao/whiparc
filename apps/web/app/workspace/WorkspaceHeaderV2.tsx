'use client';

import React, { useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { Icon } from '@iconify/react';
import ProfileMenu from '../components/ProfileMenu';
import Tooltip from '../components/Tooltip';
import { BlueprintCorners } from '../components/ui/BlueprintCorners';
import type { Project } from '../lib/types';
import type { Theme } from '../components/ui/theme-palette';

export type WorkspaceView = 'canvas' | 'variables' | 'outputs';

interface Collaborator {
  id: string;
  name: string;
  color: string;
}

export interface WorkspaceHeaderV2Props {
  selectedProject: string;
  projectDetails?: Project | null;
  activeView: WorkspaceView;
  onViewChange: (v: WorkspaceView) => void;
  theme: Theme;
  onToggleTheme: () => void;
  onExport: () => void;
  onExportFormat: (format: string) => void;
  onDeploy: () => void;
  deployStatus: string;
  onPlan: () => void;
  planStatus: string;
  autoDestroy: boolean;
  onAutoDestroyChange: (val: boolean) => void;
  onDestroy: () => void;
  onClearCanvas: () => void;
  collaborators?: Collaborator[];
  isSyncConnected?: boolean;
  saveStatus?: 'saved' | 'saving' | 'error' | 'readonly';
  onOpenSettings?: () => void;
  agentStatus?: string | null;
  migrationStatus?: { gated: boolean; has_active_agent: boolean; grace_period_end: string } | null;
}

function StatusDot({ color, label, pulse }: { color: string; label: string; pulse?: boolean }) {
  return (
    <Tooltip label={label}>
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: color,
          display: 'inline-block',
          animation: pulse ? 'wpBeat 2.2s ease-in-out infinite' : undefined,
        }}
      />
    </Tooltip>
  );
}

const menuItemStyle: CSSProperties = {
  width: '100%',
  textAlign: 'left',
  padding: '7px 9px',
  fontSize: 11.5,
  background: 'none',
  border: 0,
  color: 'var(--ink)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

export function WorkspaceHeaderV2({
  selectedProject,
  projectDetails,
  activeView,
  onViewChange,
  theme,
  onToggleTheme,
  onExport,
  onExportFormat,
  onDeploy,
  deployStatus,
  onPlan,
  planStatus,
  autoDestroy,
  onAutoDestroyChange,
  onDestroy,
  onClearCanvas,
  collaborators = [],
  isSyncConnected = false,
  saveStatus = 'saved',
  onOpenSettings,
  agentStatus = null,
  migrationStatus = null,
}: WorkspaceHeaderV2Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isBusy = deployStatus === 'RUNNING' || deployStatus === 'PENDING' || deployStatus === 'CLEANUP';
  const isPlanBusy = planStatus === 'RUNNING' || planStatus === 'PENDING';

  const tabs: { key: WorkspaceView; label: string }[] = [
    { key: 'canvas', label: 'Canvas' },
    { key: 'variables', label: 'Variables' },
    { key: 'outputs', label: 'Code Preview' },
  ];

  const saveDot =
    saveStatus === 'saved'
      ? { color: 'var(--accent-ink)', label: 'Saved', pulse: false }
      : saveStatus === 'saving'
        ? { color: 'var(--ink2)', label: 'Saving…', pulse: true }
        : saveStatus === 'error'
          ? { color: 'var(--danger)', label: 'Save conflict', pulse: false }
          : { color: 'var(--amber)', label: 'Read-only', pulse: false };

  return (
    <div style={{ flexShrink: 0, height: 52, display: 'flex', alignItems: 'center', gap: 14, padding: '0 16px', borderBottom: '1px solid var(--line)', background: 'var(--panel)' }}>
      <Link href="/dashboard" className="wp-ws-iconbtn" style={{ display: 'flex', alignItems: 'center', color: 'var(--ink2)' }} title="Back to dashboard">
        <Icon icon="lucide:arrow-left" width={15} />
      </Link>
      <span style={{ fontSize: 14, color: 'var(--ink2)', whiteSpace: 'nowrap' }}>
        <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>{projectDetails?.name || selectedProject}</strong>
      </span>
      {onOpenSettings && (
        <button type="button" onClick={onOpenSettings} className="wp-ws-iconbtn" title="Project settings" style={{ background: 'none', border: 0, color: 'var(--ink2)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
          <Icon icon="lucide:settings" width={13} />
        </button>
      )}

      <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--line)', marginLeft: 4 }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            data-active={activeView === t.key}
            onClick={() => onViewChange(t.key)}
            className="wp-ws-tab"
            style={{
              padding: '5px 12px',
              fontSize: 13,
              fontFamily: 'var(--font-display, inherit)',
              fontWeight: 600,
              background: activeView === t.key ? 'var(--accent)' : 'transparent',
              color: activeView === t.key ? 'var(--on-accent)' : 'var(--ink2)',
              border: 0,
              borderLeft: t.key === 'canvas' ? undefined : '1px solid var(--line)',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center' }} title={collaborators.length ? `${collaborators.length} other people here now` : 'Solo workspace'}>
        {collaborators.length === 0 ? (
          <span style={{ fontSize: 11, color: 'var(--ink3)', fontStyle: 'italic', whiteSpace: 'nowrap' }}>Solo</span>
        ) : (
          collaborators.map((c, i) => (
            <span
              key={c.id}
              title={c.name}
              style={{
                width: 24,
                height: 24,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: c.color,
                color: '#1A1200',
                fontFamily: 'var(--font-display, inherit)',
                fontWeight: 700,
                fontSize: 10,
                border: '2px solid var(--panel)',
                marginLeft: i > 0 ? -7 : 0,
                borderRadius: 2,
              }}
            >
              {c.name.slice(0, 2).toUpperCase()}
            </span>
          ))
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', marginLeft: 'auto', gap: 10 }}>
        {/* Compact status cluster — sync/save/agent/migration each collapse
            to a single dot with a tooltip, replacing the old always-expanded
            text badges so all of this fits back on one header row. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <StatusDot color={isSyncConnected ? 'var(--accent-ink)' : 'var(--danger)'} label={isSyncConnected ? 'Live synchronized' : 'Sync offline'} pulse={isSyncConnected} />
          <StatusDot color={saveDot.color} label={saveDot.label} pulse={saveDot.pulse} />
          {agentStatus === 'ACTIVE' && (
            <StatusDot color="var(--accent-ink)" label="Local Sandbox Agent connected — deploys will route through it." pulse />
          )}
          {agentStatus === 'PENDING' && <StatusDot color="var(--amber)" label="Agent pairing…" pulse />}
          {agentStatus === 'DISCONNECTED' && (
            <StatusDot color="var(--danger)" label="Sandbox Agent disconnected — deploys targeting it will be rejected until it reconnects (run `whiparc sandbox up`)." />
          )}
          {migrationStatus && !migrationStatus.has_active_agent && migrationStatus.gated && (
            <StatusDot color="var(--danger)" label="Free-tier sandbox deploys now require a local Sandbox Agent." />
          )}
          {migrationStatus && !migrationStatus.has_active_agent && !migrationStatus.gated && (
            <StatusDot color="var(--amber)" label={`Free-tier sandbox deploys will require a local Sandbox Agent starting ${migrationStatus.grace_period_end}.`} />
          )}
        </div>

        <button
          type="button"
          onClick={onToggleTheme}
          title="Toggle theme"
          className="wp-ws-iconbtn"
          style={{ width: 30, height: 30, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink2)', cursor: 'pointer' }}
        >
          <Icon icon={theme === 'light' ? 'lucide:moon' : 'lucide:sun'} width={14} />
        </button>

        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            title="More actions"
            className="wp-ws-iconbtn"
            style={{ width: 30, height: 30, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink2)', cursor: 'pointer' }}
          >
            <Icon icon="lucide:more-horizontal" width={15} />
          </button>
          {menuOpen && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setMenuOpen(false)} />
              <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, width: 220, background: 'var(--panel)', border: '1px solid var(--line)', zIndex: 50, padding: 4 }}>
                <button
                  type="button"
                  onClick={() => onAutoDestroyChange(!autoDestroy)}
                  className="wp-ws-navlink"
                  style={{ ...menuItemStyle, justifyContent: 'space-between' }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon icon="lucide:clock" width={12} style={{ color: autoDestroy ? 'var(--amber)' : 'var(--ink3)' }} />
                    Auto-cleanup
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono-marketing, monospace)', fontSize: 10, color: autoDestroy ? 'var(--amber)' : 'var(--ink3)' }}>
                    {autoDestroy ? 'on' : 'off'}
                  </span>
                </button>

                <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />

                {[
                  { fmt: 'tf', label: 'Terraform HCL (.tf)', icon: 'lucide:file' },
                  { fmt: 'yml', label: 'Ansible YAML (.yml)', icon: 'lucide:clipboard' },
                  { fmt: 'json', label: 'Kubernetes JSON (.json)', icon: 'lucide:layers' },
                ].map((o) => (
                  <button
                    key={o.fmt}
                    type="button"
                    onClick={() => {
                      onExportFormat(o.fmt);
                      setMenuOpen(false);
                    }}
                    className="wp-ws-navlink"
                    style={menuItemStyle}
                  >
                    <Icon icon={o.icon} width={12} style={{ color: 'var(--accent-ink)' }} />
                    {o.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    onExport();
                    setMenuOpen(false);
                  }}
                  className="wp-ws-navlink"
                  style={{ ...menuItemStyle, color: 'var(--accent-ink)', fontWeight: 600 }}
                >
                  <Icon icon="lucide:folder" width={12} />
                  Download bundle (.zip)
                </button>

                <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />

                <button
                  type="button"
                  onClick={() => {
                    if (!isBusy && !isPlanBusy) {
                      onClearCanvas();
                      setMenuOpen(false);
                    }
                  }}
                  disabled={isBusy || isPlanBusy}
                  title="Delete every node and connection on this canvas"
                  className="wp-ws-navlink"
                  style={{ ...menuItemStyle, color: 'var(--danger)', opacity: isBusy || isPlanBusy ? 0.5 : 1, cursor: isBusy || isPlanBusy ? 'default' : 'pointer' }}
                >
                  <Icon icon="lucide:eraser" width={12} />
                  Clear canvas
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (!isBusy && !isPlanBusy && !autoDestroy) {
                      onDestroy();
                      setMenuOpen(false);
                    }
                  }}
                  disabled={isBusy || isPlanBusy || autoDestroy}
                  title={autoDestroy ? 'Destroy is disabled when Auto-Cleanup is enabled' : 'Tear down all canvas-provisioned resources'}
                  className="wp-ws-navlink"
                  style={{ ...menuItemStyle, color: 'var(--danger)', opacity: isBusy || isPlanBusy || autoDestroy ? 0.5 : 1, cursor: isBusy || isPlanBusy || autoDestroy ? 'default' : 'pointer' }}
                >
                  <Icon icon="lucide:trash-2" width={12} />
                  Destroy
                </button>
              </div>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => onViewChange('outputs')}
          title="Review the compiled Terraform/Ansible/Kubernetes before deploying"
          className="wp-ws-iconbtn"
          style={{
            height: 30,
            padding: '0 13px',
            fontSize: 13,
            border: '1px solid var(--line)',
            background: 'transparent',
            color: 'var(--ink)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Icon icon="lucide:file-code" width={12} />
          Preview
        </button>

        <button
          type="button"
          onClick={onPlan}
          disabled={isPlanBusy || isBusy}
          title="Run a real terraform plan — shows what would change without applying anything"
          className="wp-ws-iconbtn"
          style={{
            height: 30,
            padding: '0 13px',
            fontSize: 13,
            border: '1px solid var(--line)',
            background: 'transparent',
            color: 'var(--ink)',
            cursor: isPlanBusy || isBusy ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            opacity: isPlanBusy || isBusy ? 0.6 : 1,
          }}
        >
          <Icon icon={isPlanBusy ? 'lucide:loader-2' : 'lucide:play'} className={isPlanBusy ? 'animate-spin' : undefined} width={12} />
          Plan
        </button>

        <button
          type="button"
          onClick={onDeploy}
          disabled={isBusy || isPlanBusy}
          className="wp-blueprint"
          style={{
            position: 'relative',
            height: 30,
            padding: '0 15px',
            fontSize: 13,
            fontFamily: 'var(--font-display, inherit)',
            fontWeight: 600,
            background: 'var(--accent)',
            color: 'var(--on-accent)',
            border: 0,
            cursor: isBusy || isPlanBusy ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            opacity: isBusy || isPlanBusy ? 0.7 : 1,
          }}
        >
          <BlueprintCorners />
          <Icon icon={isBusy ? 'lucide:loader-2' : 'lucide:rocket'} className={isBusy ? 'animate-spin' : undefined} width={12} />
          Deploy
        </button>

        <ProfileMenu variant="compact" blueprint />
      </div>
    </div>
  );
}
