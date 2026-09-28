import React, { useState, useEffect, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@iconify/react';
import { clsx } from 'clsx';
import { useAuthStore } from '../store/useAuthStore';
import { CredentialManagerTab } from './CredentialManagerModal';
import { BlueprintCorners } from './ui/BlueprintCorners';
import { LEGACY_TOKEN_SCOPE_STYLE, LEGACY_TOKEN_SCOPE_CLASS } from './ui/legacy-token-scope';
import type { Project } from '../lib/types';
import './ProjectSettingsModal.css';

interface Member {
  user_id: string;
  user_name: string;
  email: string;
  role: string;
}

interface SandboxAgent {
  agent_id: string;
  name: string;
  status: string;
  registered_at: string;
  last_seen_at?: string;
}

interface CredentialItem {
  id: string;
  project_id: string;
  provider: string;
  name: string;
  key_fingerprint: string;
  created_at: string;
}

interface ProjectSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectDetails: Project;
  onUpdateProjectDetails: (updated: Project) => void;
  projectId: string;
  onCredentialsChange?: (credentials: CredentialItem[]) => void;
}

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

const fieldTextareaStyle: CSSProperties = {
  ...fieldInputStyle,
  height: 'auto',
  minHeight: 84,
  padding: '8px 10px',
  lineHeight: 1.5,
  resize: 'vertical',
};

const sectionKickerStyle: CSSProperties = {
  margin: 0,
  fontSize: 10,
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  color: 'var(--ink3)',
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

const ghostAccentButtonStyle: CSSProperties = {
  height: 32,
  padding: '0 14px',
  background: 'transparent',
  color: 'var(--accent-ink)',
  border: '1px solid var(--accent-ink)',
  fontSize: 12.5,
  fontWeight: 600,
  fontFamily: 'var(--font-display, inherit)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  whiteSpace: 'nowrap',
};

const dangerGhostButtonStyle: CSSProperties = {
  height: 32,
  padding: '0 12px',
  background: 'transparent',
  color: 'var(--danger)',
  border: '1px solid var(--danger)',
  fontSize: 12,
  fontWeight: 600,
  fontFamily: 'var(--font-display, inherit)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};

const badgeStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  fontFamily: 'var(--font-mono-marketing, monospace)',
  fontSize: 9,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  padding: '2px 6px',
  border: '1px solid',
  whiteSpace: 'nowrap',
};

const AGENT_STATUS_COLOR: Record<string, string> = {
  ACTIVE: 'var(--accent-ink)',
  PENDING: 'var(--amber)',
  DISCONNECTED: 'var(--danger)',
  REVOKED: 'var(--ink3)',
};

export const ProjectSettingsModal: React.FC<ProjectSettingsModalProps> = ({
  isOpen,
  onClose,
  projectDetails,
  onUpdateProjectDetails,
  projectId,
  onCredentialsChange
}) => {
  const [activeTab, setActiveTab] = useState<'general' | 'members' | 'credentials' | 'agents' | 'danger'>('general');
  const [name, setName] = useState(projectDetails?.name || '');
  const [description, setDescription] = useState(projectDetails?.description || '');
  const [visibility, setVisibility] = useState(projectDetails?.visibility || 'PRIVATE');
  const [members, setMembers] = useState<Member[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('VIEWER');
  const [loading, setLoading] = useState(false);
  const [membersLoading, setMembersLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [agents, setAgents] = useState<SandboxAgent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsSupported, setAgentsSupported] = useState(true);
  const [revokingAgentId, setRevokingAgentId] = useState<string | null>(null);
  const router = useRouter();

  const { user, token } = useAuthStore();
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const activeToken = token;
  const isAdmin = projectDetails?.user_role === 'ADMIN';

  // Sync state if project details loaded after mount
  useEffect(() => {
    if (projectDetails) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName(projectDetails.name || '');
      setDescription(projectDetails.description || '');
      setVisibility(projectDetails.visibility || 'PRIVATE');
    }
  }, [projectDetails]);

  // Fetch project members on load or tab switch to members
  useEffect(() => {
    if (!isOpen || activeTab !== 'members' || !activeToken) return;

    const fetchMembers = async () => {
      setMembersLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/projects/${projectId}/members`, {
          headers: { 'Authorization': `Bearer ${activeToken}` }
        });
        if (res.ok) {
          const data = await res.json();
          setMembers(data);
        }
      } catch (err) {
        console.error("Failed to fetch members", err);
      } finally {
        setMembersLoading(false);
      }
    };

    fetchMembers();
  }, [isOpen, activeTab, projectId, API_URL, activeToken]);

  // Fetch paired sandbox agents on load or tab switch to agents. A 404 means
  // the SANDBOX_AGENT_BETA feature flag is off on this deployment entirely —
  // treated as "hide this tab's content," not an error, the same way the
  // workspace header's connection badge already treats a 404.
  useEffect(() => {
    if (!isOpen || activeTab !== 'agents' || !activeToken) return;

    const fetchAgents = async () => {
      setAgentsLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/projects/${projectId}/agents`, {
          headers: { 'Authorization': `Bearer ${activeToken}` }
        });
        if (res.ok) {
          setAgentsSupported(true);
          setAgents(await res.json());
        } else if (res.status === 404) {
          setAgentsSupported(false);
        }
      } catch (err) {
        console.error("Failed to fetch paired agents", err);
      } finally {
        setAgentsLoading(false);
      }
    };

    fetchAgents();
  }, [isOpen, activeTab, projectId, API_URL, activeToken]);

  if (!isOpen) return null;

  const handleGeneralSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeToken) return;

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${activeToken}`
        },
        body: JSON.stringify({ name, description, visibility })
      });

      if (res.ok) {
        onUpdateProjectDetails({ ...projectDetails, name, description, visibility });
        onClose();
      } else {
        const errText = await res.text();
        alert("Failed to update project: " + errText);
      }
    } catch (err) {
      console.error(err);
      alert("Error saving project settings");
    } finally {
      setLoading(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail || !activeToken) return;

    try {
      const res = await fetch(`${API_URL}/api/projects/${projectId}/members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${activeToken}`
        },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole })
      });

      if (res.ok) {
        setInviteEmail('');
        // Re-fetch members list
        const mRes = await fetch(`${API_URL}/api/projects/${projectId}/members`, {
          headers: { 'Authorization': `Bearer ${activeToken}` }
        });
        if (mRes.ok) {
          const data = await mRes.json();
          setMembers(data);
        }
      } else {
        const errText = await res.text();
        alert("Failed to invite collaborator: " + errText);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleRoleChange = async (targetUserId: string, newRole: string) => {
    if (!activeToken) return;

    try {
      const res = await fetch(`${API_URL}/api/projects/${projectId}/members/${targetUserId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${activeToken}`
        },
        body: JSON.stringify({ role: newRole })
      });

      if (res.ok) {
        setMembers(prev => prev.map(m => m.user_id === targetUserId ? { ...m, role: newRole } : m));
      } else {
        const errText = await res.text();
        alert("Failed to update member role: " + errText);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleRemoveMember = async (targetUserId: string) => {
    if (!activeToken || !confirm("Are you sure you want to remove this collaborator?")) return;

    try {
      const res = await fetch(`${API_URL}/api/projects/${projectId}/members/${targetUserId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${activeToken}`
        }
      });

      if (res.ok) {
        setMembers(prev => prev.filter(m => m.user_id !== targetUserId));
      } else {
        const errText = await res.text();
        alert("Failed to remove member: " + errText);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleRevokeAgent = async (agentId: string) => {
    if (!activeToken || !confirm("Revoke this agent? It will be disconnected immediately and its pairing token invalidated — the machine will need to re-run `whiparc sandbox up` to pair again.")) return;

    setRevokingAgentId(agentId);
    try {
      const res = await fetch(`${API_URL}/api/projects/${projectId}/agents/${agentId}/revoke`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${activeToken}` }
      });
      if (res.ok) {
        setAgents(prev => prev.map(a => a.agent_id === agentId ? { ...a, status: 'REVOKED' } : a));
      } else {
        const errText = await res.text();
        alert("Failed to revoke agent: " + errText);
      }
    } catch (err) {
      console.error(err);
      alert("Error revoking agent");
    } finally {
      setRevokingAgentId(null);
    }
  };

  const handleDeleteProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (deleteConfirm !== projectDetails?.name) {
      alert("Please type the project name exactly to confirm deletion.");
      return;
    }
    if (!activeToken) return;

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/projects/${projectId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${activeToken}` }
      });
      if (res.ok) {
        onClose();
        router.push('/dashboard');
      } else {
        const errText = await res.text();
        alert("Failed to delete project: " + errText);
      }
    } catch (err) {
      console.error(err);
      alert("Error deleting project");
    } finally {
      setLoading(false);
    }
  };

  const tabs: { key: typeof activeTab; label: string; danger?: boolean }[] = [
    { key: 'general', label: 'General Settings' },
    { key: 'members', label: 'Collaborators' },
    { key: 'credentials', label: 'Cloud Credentials' },
    { key: 'agents', label: 'Sandbox Agents' },
    ...(isAdmin ? [{ key: 'danger' as const, label: 'Danger Zone', danger: true }] : []),
  ];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(2px)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div
        className="wp-blueprint"
        style={{
          position: 'relative',
          width: 600,
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--panel)',
        }}
      >
        <BlueprintCorners />

        {/* Header */}
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ margin: 0, fontFamily: 'var(--font-display, inherit)', fontWeight: 600, fontSize: 17, color: 'var(--ink)' }}>Project Settings</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ink2)' }}>Configure visibility, collaborators, and dashboard settings.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="wp-psm-iconbtn"
            style={{ background: 'none', border: 0, color: 'var(--ink2)', cursor: 'pointer', padding: 4, flexShrink: 0 }}
          >
            <Icon icon="lucide:x" width={16} />
          </button>
        </div>

        {/* Tab Selector */}
        <div style={{ padding: '0 22px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 18 }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              data-active={activeTab === t.key}
              onClick={() => setActiveTab(t.key)}
              className="wp-psm-tab"
              style={{
                padding: '11px 0',
                background: 'none',
                border: 0,
                borderBottom: '2px solid',
                borderBottomColor: activeTab === t.key ? (t.danger ? 'var(--danger)' : 'var(--accent-ink)') : 'transparent',
                fontFamily: 'var(--font-display, inherit)',
                fontWeight: 600,
                fontSize: 13,
                color: activeTab === t.key ? (t.danger ? 'var(--danger)' : 'var(--accent-ink)') : 'var(--ink2)',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body content */}
        <div
          className={clsx(LEGACY_TOKEN_SCOPE_CLASS)}
          style={{ ...LEGACY_TOKEN_SCOPE_STYLE, flexGrow: 1, overflowY: 'auto', padding: 22 }}
        >

          {/* CREDENTIALS TAB */}
          {activeTab === 'credentials' && (
            <CredentialManagerTab
              projectId={projectId}
              token={activeToken}
              onCredentialsChange={onCredentialsChange}
            />
          )}

          {/* GENERAL SETTINGS */}
          {activeTab === 'general' && (
            <form onSubmit={handleGeneralSave} style={{ display: 'grid', gap: 16 }}>
              <div>
                <label style={fieldLabelStyle}>Project Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={!isAdmin}
                  required
                  style={{ ...fieldInputStyle, opacity: isAdmin ? 1 : 0.5 }}
                  placeholder="e.g. Production Cluster Setup"
                />
              </div>

              <div>
                <label style={fieldLabelStyle}>Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={!isAdmin}
                  rows={3}
                  style={{ ...fieldTextareaStyle, opacity: isAdmin ? 1 : 0.5 }}
                  placeholder="Configure AWS infrastructure deploying EC2 instances..."
                />
              </div>

              <div>
                <label style={fieldLabelStyle}>Project Visibility</label>
                <select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value)}
                  disabled={!isAdmin}
                  style={{ ...fieldInputStyle, opacity: isAdmin ? 1 : 0.5, cursor: 'pointer' }}
                >
                  <option value="PRIVATE">Private (Only selected members)</option>
                  <option value="TEAM">Team (Accessible to team organization members)</option>
                  <option value="PUBLIC">Public Catalog (Discoverable by everyone)</option>
                </select>
              </div>

              {isAdmin ? (
                <div style={{ paddingTop: 12, marginTop: 4, borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                  <button type="button" onClick={onClose} style={secondaryButtonStyle}>
                    Cancel
                  </button>
                  <button type="submit" disabled={loading} className="wp-blueprint" style={{ ...primaryButtonStyle, opacity: loading ? 0.7 : 1 }}>
                    <BlueprintCorners />
                    {loading && <Icon icon="lucide:loader-2" className="animate-spin" width={13} />}
                    Save Changes
                  </button>
                </div>
              ) : (
                <div style={{ padding: 10, border: '1px solid var(--amber)', color: 'var(--amber)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon icon="lucide:lock" width={14} style={{ flexShrink: 0 }} />
                  Visibility and name modifications are limited to project administrators.
                </div>
              )}
            </form>
          )}

          {/* MEMBERS LIST */}
          {activeTab === 'members' && (
            <div style={{ display: 'grid', gap: 20 }}>

              {/* Add Member form for Admin */}
              {isAdmin && (
                <form onSubmit={handleInvite} style={{ border: '1px solid var(--line)', padding: 14, display: 'grid', gap: 10 }}>
                  <h4 style={{ margin: 0, fontFamily: 'var(--font-display, inherit)', fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>Add Collaborator</h4>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      required
                      placeholder="user@whiparc.com"
                      style={{ ...fieldInputStyle, flex: 1, height: 32 }}
                    />
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value)}
                      style={{ ...fieldInputStyle, width: 110, height: 32, cursor: 'pointer' }}
                    >
                      <option value="VIEWER">Viewer</option>
                      <option value="EDITOR">Editor</option>
                      <option value="ADMIN">Admin</option>
                    </select>
                    <button type="submit" style={ghostAccentButtonStyle}>
                      <Icon icon="lucide:plus" width={13} /> Add
                    </button>
                  </div>
                </form>
              )}

              {/* Members listing */}
              <div style={{ display: 'grid', gap: 10 }}>
                <h4 style={sectionKickerStyle}>Active Workspace Members</h4>
                {membersLoading ? (
                  <div style={{ padding: '20px 0', display: 'flex', justifyContent: 'center', color: 'var(--ink2)' }}>
                    <Icon icon="lucide:loader-2" className="animate-spin" width={18} style={{ color: 'var(--accent-ink)' }} />
                  </div>
                ) : members.length === 0 ? (
                  <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 12.5, color: 'var(--ink2)' }}>No collaborators added.</div>
                ) : (
                  <div style={{ border: '1px solid var(--line)' }}>
                    {members.map((m, i) => {
                      const initials = m.user_name ? m.user_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() : '?';
                      const isOwner = m.user_id === projectDetails?.created_by;
                      return (
                        <div
                          key={m.user_id}
                          style={{ padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, borderTop: i > 0 ? '1px solid var(--line)' : undefined }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ height: 32, width: 32, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display, inherit)', fontWeight: 700, fontSize: 11, color: 'var(--on-accent)', background: 'var(--accent)' }}>
                              {initials}
                            </div>
                            <div>
                              <div style={{ fontWeight: 600, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                {m.user_name}
                                {isOwner && (
                                  <span style={{ ...badgeStyle, color: 'var(--amber)', borderColor: 'var(--amber)' }}>Owner</span>
                                )}
                              </div>
                              <div style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{m.email}</div>
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {isAdmin && !isOwner && m.user_id !== user?.id ? (
                              <>
                                <select
                                  value={m.role}
                                  onChange={(e) => handleRoleChange(m.user_id, e.target.value)}
                                  style={{ ...fieldInputStyle, width: 96, height: 28, fontSize: 11.5, cursor: 'pointer' }}
                                >
                                  <option value="VIEWER">Viewer</option>
                                  <option value="EDITOR">Editor</option>
                                  <option value="ADMIN">Admin</option>
                                </select>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveMember(m.user_id)}
                                  className="wp-psm-iconbtn"
                                  title="Remove Member"
                                  style={{ background: 'none', border: '1px solid var(--line)', color: 'var(--ink2)', cursor: 'pointer', padding: 6, display: 'flex' }}
                                >
                                  <Icon icon="lucide:user-minus" width={13} />
                                </button>
                              </>
                            ) : (
                              <span style={{ ...badgeStyle, color: 'var(--ink2)', borderColor: 'var(--line)' }}>{m.role}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SANDBOX AGENTS */}
          {activeTab === 'agents' && (
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <h4 style={sectionKickerStyle}>Paired Sandbox Agents</h4>
                <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--ink2)', lineHeight: 1.5 }}>
                  Machines paired via `whiparc sandbox up` that can run this project&apos;s deploys locally. Revoking disconnects an agent immediately and invalidates its pairing token.
                </p>
              </div>
              {agentsLoading ? (
                <div style={{ padding: '20px 0', display: 'flex', justifyContent: 'center', color: 'var(--ink2)' }}>
                  <Icon icon="lucide:loader-2" className="animate-spin" width={18} style={{ color: 'var(--accent-ink)' }} />
                </div>
              ) : !agentsSupported ? (
                <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 12.5, color: 'var(--ink2)' }}>Local Sandbox Agents aren&apos;t enabled on this deployment.</div>
              ) : agents.length === 0 ? (
                <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 12.5, color: 'var(--ink2)' }}>No sandbox agents have been paired to this project yet.</div>
              ) : (
                <div style={{ border: '1px solid var(--line)' }}>
                  {agents.map((a, i) => {
                    const isRevoked = a.status === 'REVOKED';
                    const statusColor = AGENT_STATUS_COLOR[a.status] || AGENT_STATUS_COLOR.REVOKED;
                    return (
                      <div key={a.agent_id} style={{ padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, borderTop: i > 0 ? '1px solid var(--line)' : undefined }}>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 8 }}>
                            {a.name}
                            <span style={{ ...badgeStyle, color: statusColor, borderColor: statusColor }}>{a.status}</span>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--ink2)', fontFamily: 'var(--font-mono-marketing, monospace)' }}>{a.agent_id}</div>
                          <div style={{ fontSize: 10.5, color: 'var(--ink3)', marginTop: 2 }}>
                            Paired {new Date(a.registered_at).toLocaleString()}
                            {a.last_seen_at && ` · Last seen ${new Date(a.last_seen_at).toLocaleString()}`}
                          </div>
                        </div>
                        {!isRevoked && (
                          <button
                            type="button"
                            onClick={() => handleRevokeAgent(a.agent_id)}
                            disabled={revokingAgentId === a.agent_id}
                            style={{ ...dangerGhostButtonStyle, opacity: revokingAgentId === a.agent_id ? 0.5 : 1, flexShrink: 0 }}
                          >
                            {revokingAgentId === a.agent_id && <Icon icon="lucide:loader-2" className="animate-spin" width={11} />}
                            Revoke
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* DANGER ZONE (DELETE PROJECT) */}
          {activeTab === 'danger' && isAdmin && (
            <div style={{ display: 'grid', gap: 16 }}>
              <div style={{ padding: 14, border: '1px solid var(--danger)', color: 'var(--danger)', display: 'grid', gap: 6 }}>
                <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                  <Icon icon="lucide:alert-triangle" width={16} />
                  Warning: Irreversible action
                </h4>
                <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, opacity: 0.9 }}>
                  Deleting this project will permanently remove the canvas configurations, parameter inputs, live deployment credentials, and execution histories from the workspace. This action cannot be undone.
                </p>
              </div>

              <form onSubmit={handleDeleteProject} style={{ display: 'grid', gap: 16 }}>
                <div>
                  <label style={fieldLabelStyle}>
                    Please type <strong style={{ color: 'var(--ink)', textTransform: 'none', letterSpacing: 'normal' }}>{projectDetails?.name}</strong> to confirm:
                  </label>
                  <input
                    type="text"
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    required
                    style={{ ...fieldInputStyle, borderColor: 'var(--danger)', color: 'var(--danger)' }}
                    placeholder="Project name"
                  />
                </div>

                <div style={{ paddingTop: 12, borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="submit"
                    disabled={loading || deleteConfirm !== projectDetails?.name}
                    className="wp-blueprint"
                    style={{ ...primaryButtonStyle, background: 'var(--danger)', opacity: (loading || deleteConfirm !== projectDetails?.name) ? 0.5 : 1 }}
                  >
                    <BlueprintCorners />
                    {loading && <Icon icon="lucide:loader-2" className="animate-spin" width={13} />}
                    Permanently Delete Project
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
