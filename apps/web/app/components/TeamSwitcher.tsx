'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Icon } from '@iconify/react';
import type { Team } from '../lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface TeamSwitcherProps {
  teams: Team[];
  currentTeamId: string | null;
  onSelectTeam: (teamId: string) => void;
  onTeamCreated: (team: Team) => void;
  token: string;
}

const menuItemStyle: CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '7px 9px',
  fontSize: 13,
  color: 'var(--ink)',
  background: 'none',
  border: 0,
  cursor: 'pointer',
  textAlign: 'left',
};

// Product-memory 08.5 item A7. Every real user has exactly one team today
// (auto-created at signup) since nothing in the UI ever called the
// already-existing POST /api/teams — this component is both the switcher
// and the only "create a second team" entry point, so it's actually useful
// the day it ships rather than always showing one option.
export function TeamSwitcher({ teams, currentTeamId, onSelectTeam, onTeamCreated, token }: TeamSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentTeam = teams.find((t) => t.id === currentTeamId) ?? teams[0];

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setIsCreating(false);
      }
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setIsCreating(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  useEffect(() => {
    if (isCreating) inputRef.current?.focus();
  }, [isCreating]);

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newTeamName.trim();
    if (!name) return;
    setIsSubmitting(true);
    setCreateError(null);
    try {
      const res = await fetch(`${API_URL}/api/teams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error((await res.text()) || 'Failed to create team');
      const team: Team = await res.json();
      onTeamCreated(team);
      onSelectTeam(team.id);
      setNewTeamName('');
      setIsCreating(false);
      setOpen(false);
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create team');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 10px', fontSize: 14, border: '1px solid var(--line)', color: 'var(--ink)', whiteSpace: 'nowrap', background: 'transparent', cursor: 'pointer' }}
      >
        {currentTeam?.name || 'personal'}
        <Icon icon="lucide:chevron-down" width={12} style={{ color: 'var(--ink3)', transform: open ? 'rotate(180deg)' : undefined }} />
      </button>

      {open && (
        <div style={{ position: 'absolute', left: 0, top: '100%', marginTop: 4, width: 260, background: 'var(--panel)', border: '1px solid var(--line)', zIndex: 50, padding: 4 }}>
          <p style={{ margin: '4px 9px', fontFamily: 'var(--font-mono-marketing)', fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Your teams</p>
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              onClick={() => {
                onSelectTeam(team.id);
                setOpen(false);
              }}
              style={{ ...menuItemStyle, justifyContent: 'space-between', color: team.id === currentTeam?.id ? 'var(--accent-ink)' : 'var(--ink)' }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team.name}</span>
              {team.id === currentTeam?.id && <Icon icon="lucide:check" width={13} style={{ flexShrink: 0 }} />}
            </button>
          ))}

          <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />

          {isCreating ? (
            <form onSubmit={handleCreateTeam} style={{ padding: '4px 9px 8px' }}>
              <input
                ref={inputRef}
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                placeholder="Team name"
                style={{ width: '100%', height: 30, padding: '0 8px', fontSize: 13, border: '1px solid var(--line)', background: 'var(--ground)', color: 'var(--ink)', outline: 'none' }}
              />
              {createError && <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--danger)' }}>{createError}</p>}
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button
                  type="submit"
                  disabled={isSubmitting || !newTeamName.trim()}
                  style={{ flex: 1, height: 28, fontSize: 12.5, background: 'var(--accent)', color: 'var(--on-accent)', border: 0, cursor: isSubmitting ? 'default' : 'pointer', opacity: isSubmitting || !newTeamName.trim() ? 0.6 : 1 }}
                >
                  {isSubmitting ? 'Creating…' : 'Create'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsCreating(false);
                    setCreateError(null);
                  }}
                  style={{ height: 28, padding: '0 10px', fontSize: 12.5, background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink2)', cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button type="button" onClick={() => setIsCreating(true)} style={{ ...menuItemStyle, color: 'var(--accent-ink)' }}>
              <Icon icon="lucide:plus" width={13} />
              Create team
            </button>
          )}
        </div>
      )}
    </div>
  );
}
