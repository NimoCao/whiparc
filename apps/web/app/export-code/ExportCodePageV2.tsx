'use client';

import React, { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@iconify/react';
import useCanvasStore from '../store/useCanvasStore';
import { useAuthStore } from '../store/useAuthStore';
import ProfileMenu from '../components/ProfileMenu';
import { BlueprintCorners } from '../components/ui/BlueprintCorners';
import { THEME_PALETTES, type Theme } from '../components/ui/theme-palette';
import { spaceGroteskFont, barlowFont, jetBrainsMonoFont } from '../fonts';
import { generateBundleFiles, downloadZipBundle, type FileItem } from '../lib/bundleGenerator';
import type { Project } from '../lib/types';
import '../components/ui/blueprint.css';
import './export-code.css';

// Tech-category colors, matching the canvas node ribbon/edge palette
// (see product-memory: 05.5 Design System & Color Palette).
const FOLDER_META: Record<string, { label: string; color: string }> = {
  terraform: { label: 'terraform/', color: 'var(--accent-ink)' },
  ansible: { label: 'ansible/', color: '#8B5CF6' },
  k8s: { label: 'k8s/', color: '#0EA5E9' },
};

// Code-viewer syntax tokens — scoped to this page (not part of the shared
// THEME_PALETTES) because they're specific to the export code panel's
// terminal-like presentation. Values match the mockup's own DARK/LIGHT
// constants exactly, so the syntax highlighting stays legible in both themes
// instead of falling back to inherited (unstyled) text color.
const CODE_PALETTES: Record<Theme, Record<string, string>> = {
  dark: {
    '--code-bg': '#101114',
    '--code-tab-bg': '#17181C',
    '--code-border': '#2A2C33',
    '--code-tab-text': '#FFFFFF',
    '--code-text': '#CBD5E1',
    '--code-linenum': '#7B7E88',
    '--code-comment': '#A3A6AF',
    '--code-keyword': '#FF8A63',
    '--code-string': '#F59E0B',
    '--code-type': '#10B981',
  },
  light: {
    '--code-bg': '#F4F5F8',
    '--code-tab-bg': '#FFFFFF',
    '--code-border': '#E1E2E6',
    '--code-tab-text': '#101114',
    '--code-text': '#333B4A',
    '--code-linenum': '#9AA3B5',
    '--code-comment': '#6B7385',
    '--code-keyword': '#C2410C',
    '--code-string': '#B45309',
    '--code-type': '#047857',
  },
};

function highlightLine(line: string, lang: string): React.ReactNode {
  const trimmed = line.trim();
  if (trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.startsWith('---')) {
    return <span style={{ color: 'var(--code-comment)' }}>{line}</span>;
  }

  if (lang !== 'HCL' && lang !== 'YAML' && lang !== 'INI' && lang !== 'Markdown') {
    return line;
  }

  const parts = line.split(/("[^"]*")/g);
  return parts.map((part, pIdx) => {
    if (part.startsWith('"') && part.endsWith('"')) {
      return (
        <span key={pIdx} style={{ color: 'var(--code-string)' }}>
          {part}
        </span>
      );
    }
    if (part.includes('resource ') || part.includes('provider ') || part.includes('variable ') || part.includes('output ') || part.includes('module ') || part.includes('data ')) {
      const subParts = part.split(/(resource|provider|variable|output|module|data)/g);
      return subParts.map((sub, sIdx) =>
        ['resource', 'provider', 'variable', 'output', 'module', 'data'].includes(sub) ? (
          <span key={sIdx} style={{ color: 'var(--code-keyword)' }}>
            {sub}
          </span>
        ) : (
          sub
        )
      );
    }
    return part;
  });
}

const filebtnBaseStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '6px 10px 6px 20px',
  fontSize: 13,
  fontFamily: 'var(--font-mono-marketing), monospace',
  border: 0,
  borderLeft: '2px solid transparent',
  background: 'transparent',
  cursor: 'pointer',
  textAlign: 'left',
};

export function ExportCodePageV2() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get('project');
  const { nodes, edges, setNodes, setEdges, setProjectId } = useCanvasStore();
  const { token, user, hasHydrated } = useAuthStore();

  const [theme, setTheme] = useState<Theme>('dark');
  const [selectedFilePath, setSelectedFilePath] = useState<string>('');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [projectDetails, setProjectDetails] = useState<Project | null>(null);
  const [isLoadingCanvas, setIsLoadingCanvas] = useState<boolean>(true);

  // Bare /export-code has no project context to export from
  useEffect(() => {
    if (!projectId) {
      router.replace('/dashboard');
    }
  }, [projectId, router]);

  // Route protection — wait for the persisted store to rehydrate before deciding
  useEffect(() => {
    if (hasHydrated && !token) {
      router.push('/login');
    }
  }, [hasHydrated, token, router]);

  // Fetch project details & canvas state for this project id so the page is
  // refresh-safe instead of depending purely on in-memory Zustand state
  useEffect(() => {
    if (!token || !projectId || !user) return;
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
    let cancelled = false;

    const loadProjectAndCanvas = async () => {
      setIsLoadingCanvas(true);
      try {
        const projRes = await fetch(`${API_URL}/api/projects/${projectId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (projRes.ok) {
          const projDetails = await projRes.json();
          if (!cancelled) setProjectDetails(projDetails);
        }

        const canvasRes = await fetch(`${API_URL}/api/projects/${projectId}/canvas`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (canvasRes.ok) {
          const state = await canvasRes.json();
          const parsedNodes = JSON.parse(state.nodes_json || '[]');
          const parsedEdges = JSON.parse(state.edges_json || '[]');
          setNodes(parsedNodes);
          setEdges(parsedEdges);
          setProjectId(projectId);
        }
      } catch (err) {
        console.warn('Failed to load project canvas data', err);
      } finally {
        if (!cancelled) setIsLoadingCanvas(false);
      }
    };

    loadProjectAndCanvas();
    return () => {
      cancelled = true;
    };
  }, [projectId, token, user, setNodes, setEdges, setProjectId]);

  // Compile files dynamically from canvas Zustand store
  const bundleFiles = useMemo(() => generateBundleFiles(nodes, edges), [nodes, edges]);

  // Auto-select first file whenever the file list changes
  useEffect(() => {
    if (bundleFiles.length > 0 && (!selectedFilePath || !bundleFiles.find((f) => f.path === selectedFilePath))) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedFilePath(bundleFiles[0].path);
    }
  }, [bundleFiles, selectedFilePath]);

  const activeFile = useMemo(() => bundleFiles.find((f) => f.path === selectedFilePath) ?? bundleFiles[0], [bundleFiles, selectedFilePath]);

  const folders = useMemo(() => {
    const map: Record<string, FileItem[]> = {};
    for (const f of bundleFiles) {
      const slash = f.path.indexOf('/');
      const dir = slash === -1 ? '__root__' : f.path.slice(0, slash);
      if (!map[dir]) map[dir] = [];
      map[dir].push(f);
    }
    return map;
  }, [bundleFiles]);

  const handleCopyCode = () => {
    if (!activeFile) return;
    navigator.clipboard.writeText(activeFile.content);
    setCopyStatus('copied');
    setTimeout(() => setCopyStatus('idle'), 2000);
  };

  const handleDownloadBundle = async () => {
    setIsDownloading(true);
    try {
      await downloadZipBundle(nodes, edges);
    } catch (e) {
      console.error(e);
    } finally {
      setIsDownloading(false);
    }
  };

  const palette = THEME_PALETTES[theme];
  const codePalette = CODE_PALETTES[theme];
  const rootVars = useMemo(
    () =>
      ({
        ...palette,
        ...codePalette,
        background: palette['--ground'],
        color: palette['--ink'],
      }) as CSSProperties,
    [palette, codePalette]
  );

  if (!projectId || isLoadingCanvas) {
    return (
      <div style={{ height: '100vh', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#101114', color: '#A3A6AF' }}>
        <Icon icon="lucide:loader-2" className="animate-spin" width={28} />
      </div>
    );
  }

  return (
    <div
      className={`${spaceGroteskFont.variable} ${barlowFont.variable} ${jetBrainsMonoFont.variable}`}
      style={{ ...rootVars, height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-body-marketing), system-ui, sans-serif', transition: 'background .3s ease, color .3s ease' }}
    >
      {/* HEADER */}
      <header style={{ height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14, padding: '0 16px', borderBottom: '1px solid var(--line)', background: 'var(--panel)' }}>
        <Link href={`/workspace?project=${projectId}`} className="wp-export-iconbtn" style={{ display: 'flex', alignItems: 'center', color: 'var(--ink2)' }} title="Back to workspace">
          <Icon icon="lucide:arrow-left" width={15} />
        </Link>
        <span style={{ fontSize: 14, color: 'var(--ink2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {projectDetails?.name || projectId} / <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>export</strong>
        </span>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
            title="Toggle theme"
            className="wp-export-iconbtn"
            style={{ width: 30, height: 30, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink2)', cursor: 'pointer' }}
          >
            <Icon icon={theme === 'light' ? 'lucide:moon' : 'lucide:sun'} width={14} />
          </button>
          {activeFile && (
            <button
              type="button"
              onClick={handleCopyCode}
              className="wp-export-navlink"
              style={{ height: 30, padding: '0 13px', fontSize: 13, border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Icon icon={copyStatus === 'copied' ? 'lucide:check' : 'lucide:copy'} width={12} />
              {copyStatus === 'copied' ? 'Copied' : 'Copy'}
            </button>
          )}
          <button
            type="button"
            onClick={handleDownloadBundle}
            disabled={isDownloading || bundleFiles.length === 0}
            className="wp-blueprint wp-export-submit"
            style={{ position: 'relative', height: 30, padding: '0 15px', fontSize: 13, background: 'var(--accent)', color: 'var(--on-accent)', border: 0, cursor: bundleFiles.length === 0 ? 'not-allowed' : 'pointer', opacity: bundleFiles.length === 0 ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <BlueprintCorners />
            <Icon icon={isDownloading ? 'lucide:loader-2' : 'lucide:download'} width={12} className={isDownloading ? 'animate-spin' : undefined} />
            {isDownloading ? 'Generating…' : 'Download bundle'}
          </button>
          <ProfileMenu blueprint />
        </div>
      </header>

      {/* BODY */}
      {bundleFiles.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--ink2)', padding: 24 }}>
          <Icon icon="lucide:layout-template" width={40} style={{ opacity: 0.3 }} />
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>Canvas is empty</p>
          <p style={{ margin: 0, fontSize: 13, textAlign: 'center', maxWidth: 360 }}>
            Add Terraform, Ansible, or Kubernetes nodes to the canvas and come back to export the generated code.
          </p>
          <Link href={`/workspace?project=${projectId}`} className="wp-export-toclink" style={{ marginTop: 4, fontSize: 13, color: 'var(--accent-ink)' }}>
            Go to canvas
          </Link>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '220px 1fr', minHeight: 0 }}>
          {/* FILE TREE */}
          <aside style={{ borderRight: '1px solid var(--line)', background: 'var(--panel)', overflowY: 'auto', padding: '14px 10px' }}>
            {Object.entries(folders).map(([dir, dirFiles]) => {
              if (dir === '__root__') {
                return (
                  <div key="root" style={{ display: 'grid', gap: 1, marginBottom: 12 }}>
                    {dirFiles.map((file) => {
                      const isSelected = selectedFilePath === file.path;
                      return (
                        <button
                          key={file.path}
                          type="button"
                          onClick={() => setSelectedFilePath(file.path)}
                          className={isSelected ? undefined : 'wp-export-filebtn'}
                          style={{
                            ...filebtnBaseStyle,
                            color: isSelected ? 'var(--ink)' : 'var(--ink2)',
                            background: isSelected ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                            borderLeft: isSelected ? '2px solid var(--accent)' : '2px solid transparent',
                          }}
                        >
                          {file.name}
                        </button>
                      );
                    })}
                  </div>
                );
              }
              const meta = FOLDER_META[dir] || { label: `${dir}/`, color: 'var(--ink)' };
              return (
                <div key={dir} style={{ marginBottom: 12 }}>
                  <p style={{ margin: '0 0 6px', padding: '0 8px', fontFamily: 'var(--font-mono-marketing)', fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Icon icon="lucide:folder" width={12} style={{ color: meta.color }} />
                    {meta.label}
                  </p>
                  <div style={{ display: 'grid', gap: 1 }}>
                    {dirFiles.map((file) => {
                      const isSelected = selectedFilePath === file.path;
                      return (
                        <button
                          key={file.path}
                          type="button"
                          onClick={() => setSelectedFilePath(file.path)}
                          className={isSelected ? undefined : 'wp-export-filebtn'}
                          style={{
                            ...filebtnBaseStyle,
                            color: isSelected ? 'var(--ink)' : 'var(--ink2)',
                            background: isSelected ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                            borderLeft: isSelected ? '2px solid var(--accent)' : '2px solid transparent',
                          }}
                        >
                          {file.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </aside>

          {/* CODE VIEWER */}
          {activeFile && (
            <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--code-bg)' }}>
              <div style={{ flexShrink: 0, display: 'flex', borderBottom: '1px solid var(--code-border)' }}>
                <span style={{ padding: '9px 16px', fontFamily: 'var(--font-mono-marketing)', fontSize: 12.5, color: 'var(--code-tab-text)', borderRight: '1px solid var(--code-border)', background: 'var(--code-tab-bg)' }}>
                  {activeFile.name}
                </span>
              </div>
              <div style={{ flex: 1, overflow: 'auto', padding: '18px 22px', fontFamily: 'var(--font-mono-marketing), monospace', fontSize: 13, lineHeight: 1.85, color: 'var(--code-text)' }}>
                {activeFile.content.split('\n').map((line, idx) => (
                  <div key={idx} style={{ display: 'flex' }}>
                    <span style={{ width: 30, flexShrink: 0, textAlign: 'right', paddingRight: 14, color: 'var(--code-linenum)', userSelect: 'none' }}>{idx + 1}</span>
                    <span style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{highlightLine(line, activeFile.language) || ' '}</span>
                  </div>
                ))}
              </div>
              <div style={{ flexShrink: 0, height: 28, display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', borderTop: '1px solid var(--code-border)', fontFamily: 'var(--font-mono-marketing)', fontSize: 10.5, color: 'var(--code-linenum)' }}>
                <span>{activeFile.lines} lines</span>
                <span>{activeFile.size}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
