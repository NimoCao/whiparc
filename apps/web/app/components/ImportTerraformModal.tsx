'use client';

import React, { useState, useEffect, useRef, type CSSProperties } from 'react';
import { Icon } from '@iconify/react';
import { BlueprintCorners } from './ui/BlueprintCorners';
import type { Project, Team } from '../lib/types';

interface ImportTerraformModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: string;
  /** Existing projects the user can import into (EDITOR/ADMIN only —
      import writes to the canvas, matching handleImport's own
      RequireProjectRole("EDITOR") gate). */
  editableProjects: Project[];
  onImported: (projectId: string) => void;
}

const SUPPORTED_EXT = ['.tf', '.yml', '.yaml'];

const fieldLabelStyle: CSSProperties = {
  display: 'block',
  margin: '0 0 6px',
  fontSize: 10,
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  color: 'var(--ink2)',
};

const fieldInputStyle: CSSProperties = {
  width: '100%',
  height: 36,
  padding: '0 10px',
  border: '1px solid var(--line)',
  background: 'var(--elevated)',
  color: 'var(--ink)',
  fontSize: 13,
  fontFamily: 'var(--font-body-marketing, inherit)',
  outline: 'none',
};

const primaryButtonStyle: CSSProperties = {
  position: 'relative',
  height: 36,
  padding: '0 18px',
  background: 'var(--accent)',
  color: 'var(--on-accent)',
  border: 0,
  fontSize: 13,
  fontWeight: 600,
  fontFamily: 'var(--font-display, inherit)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
};

const secondaryButtonStyle: CSSProperties = {
  height: 36,
  padding: '0 16px',
  background: 'transparent',
  color: 'var(--ink)',
  border: '1px solid var(--line)',
  fontSize: 13,
  fontWeight: 600,
  fontFamily: 'var(--font-display, inherit)',
  cursor: 'pointer',
};

function isSupportedFile(name: string): boolean {
  const lower = name.toLowerCase();
  return SUPPORTED_EXT.some((ext) => lower.endsWith(ext));
}

export function ImportTerraformModal({ isOpen, onClose, token, editableProjects, onImported }: ImportTerraformModalProps) {
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const [mode, setMode] = useState<'existing' | 'new'>(editableProjects.length > 0 ? 'existing' : 'new');
  const [selectedProjectId, setSelectedProjectId] = useState(editableProjects[0]?.id || '');
  const [newName, setNewName] = useState('');
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen || !token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/teams`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok || cancelled) return;
        const data: Team[] = await res.json();
        setTeams(data);
        if (data.length > 0) setSelectedTeamId((prev) => prev || data[0].id);
      } catch {
        // team list only matters for "create new project" — leaving it
        // empty just disables that path, existing-project import still works
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, token, API_URL]);

  if (!isOpen) return null;

  const addFiles = (list: FileList | File[]) => {
    const incoming = Array.from(list).filter((f) => isSupportedFile(f.name));
    if (incoming.length === 0 && list.length > 0) {
      setError('Only .tf, .yml, and .yaml files are supported.');
      return;
    }
    setError(null);
    setFiles((prev) => {
      const existingNames = new Set(prev.map((f) => f.name));
      return [...prev, ...incoming.filter((f) => !existingNames.has(f.name))];
    });
  };

  const removeFile = (name: string) => setFiles((prev) => prev.filter((f) => f.name !== name));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setWarning(null);
    if (files.length === 0) {
      setError('Add at least one .tf, .yml, or .yaml file to import.');
      return;
    }
    if (mode === 'existing' && !selectedProjectId) {
      setError('Choose a project to import into.');
      return;
    }
    if (mode === 'new' && (!newName.trim() || !selectedTeamId)) {
      setError('Name the new project and pick a team.');
      return;
    }

    setIsSubmitting(true);
    try {
      const readFiles = await Promise.all(
        files.map(
          (f) =>
            new Promise<{ name: string; content: string }>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve({ name: f.name, content: String(reader.result || '') });
              reader.onerror = () => reject(new Error(`Failed to read ${f.name}`));
              reader.readAsText(f);
            })
        )
      );

      let targetProjectId = selectedProjectId;
      if (mode === 'new') {
        const createRes = await fetch(`${API_URL}/api/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ name: newName.trim(), description: '', visibility: 'PRIVATE', team_id: selectedTeamId }),
        });
        if (!createRes.ok) throw new Error((await createRes.text()) || 'Failed to create project');
        const created = await createRes.json();
        targetProjectId = created.id;
      }

      const importRes = await fetch(`${API_URL}/api/projects/${targetProjectId}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ files: readFiles }),
      });
      if (!importRes.ok) throw new Error((await importRes.text()) || 'Import failed');
      const result = await importRes.json();

      const nodeCount = Array.isArray(result.nodes) ? result.nodes.length : JSON.parse(result.nodes ?? '[]').length;
      if (nodeCount === 0) {
        // Files were accepted (no parse error), but nothing recognizable came
        // out of them — surfaced as a warning rather than silently opening
        // an unchanged canvas.
        setWarning('No infrastructure resources were recognized in the uploaded files. The canvas was not changed.');
        setIsSubmitting(false);
        return;
      }

      onImported(targetProjectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(2px)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="wp-blueprint" style={{ position: 'relative', width: 520, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--panel)' }}>
        <BlueprintCorners />

        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ margin: 0, fontFamily: 'var(--font-display, inherit)', fontWeight: 600, fontSize: 17, color: 'var(--ink)' }}>Import Terraform / Ansible / Kubernetes</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ink2)' }}>Upload .tf, .yml, or .yaml files to generate canvas nodes.</p>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 0, color: 'var(--ink2)', cursor: 'pointer', padding: 4, flexShrink: 0 }}>
            <Icon icon="lucide:x" width={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ flexGrow: 1, overflowY: 'auto', padding: 22, display: 'grid', gap: 16 }}>
          <div>
            <label style={fieldLabelStyle}>Import into</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <button
                type="button"
                onClick={() => setMode('existing')}
                disabled={editableProjects.length === 0}
                style={{ ...secondaryButtonStyle, flex: 1, height: 32, opacity: editableProjects.length === 0 ? 0.4 : 1, background: mode === 'existing' ? 'var(--accent)' : 'transparent', color: mode === 'existing' ? 'var(--on-accent)' : 'var(--ink)', borderColor: mode === 'existing' ? 'var(--accent)' : 'var(--line)' }}
              >
                Existing project
              </button>
              <button
                type="button"
                onClick={() => setMode('new')}
                style={{ ...secondaryButtonStyle, flex: 1, height: 32, background: mode === 'new' ? 'var(--accent)' : 'transparent', color: mode === 'new' ? 'var(--on-accent)' : 'var(--ink)', borderColor: mode === 'new' ? 'var(--accent)' : 'var(--line)' }}
              >
                New project
              </button>
            </div>

            {mode === 'existing' ? (
              <select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)} style={{ ...fieldInputStyle, cursor: 'pointer' }}>
                {editableProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Project name"
                  style={fieldInputStyle}
                />
                <select value={selectedTeamId} onChange={(e) => setSelectedTeamId(e.target.value)} style={{ ...fieldInputStyle, cursor: 'pointer' }}>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div>
            <label style={fieldLabelStyle}>Files</label>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                addFiles(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `1px dashed ${isDragging ? 'var(--accent-ink)' : 'var(--line)'}`,
                background: isDragging ? 'color-mix(in srgb, var(--accent) 6%, transparent)' : 'transparent',
                padding: '22px 16px',
                textAlign: 'center',
                cursor: 'pointer',
                color: 'var(--ink2)',
              }}
            >
              <Icon icon="lucide:upload-cloud" width={22} style={{ color: 'var(--ink3)', marginBottom: 6 }} />
              <p style={{ margin: 0, fontSize: 12.5 }}>Drag files here, or click to browse</p>
              <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--ink3)' }}>.tf, .yml, .yaml</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".tf,.yml,.yaml"
                onChange={(e) => e.target.files && addFiles(e.target.files)}
                style={{ display: 'none' }}
              />
            </div>

            {files.length > 0 && (
              <div style={{ marginTop: 10, border: '1px solid var(--line)' }}>
                {files.map((f, i) => (
                  <div key={f.name} style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12.5, borderTop: i > 0 ? '1px solid var(--line)' : undefined }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                      <Icon icon="lucide:file-code" width={13} style={{ color: 'var(--ink3)', flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                    </span>
                    <button type="button" onClick={() => removeFile(f.name)} style={{ background: 'none', border: 0, color: 'var(--ink3)', cursor: 'pointer', flexShrink: 0 }}>
                      <Icon icon="lucide:x" width={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)', background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid var(--danger)', padding: '8px 10px' }}>{error}</p>
          )}
          {warning && (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--amber)', background: 'color-mix(in srgb, var(--amber) 10%, transparent)', border: '1px solid var(--amber)', padding: '8px 10px' }}>{warning}</p>
          )}

          <div style={{ paddingTop: 12, borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="button" onClick={onClose} style={secondaryButtonStyle}>
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting} className="wp-blueprint" style={{ ...primaryButtonStyle, opacity: isSubmitting ? 0.7 : 1 }}>
              <BlueprintCorners />
              {isSubmitting && <Icon icon="lucide:loader-2" className="animate-spin" width={13} />}
              Import
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
