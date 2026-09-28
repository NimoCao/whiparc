'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Icon } from '@iconify/react';

interface CredentialItem {
	id: string;
	project_id: string;
	provider: string;
	name: string;
	key_fingerprint: string;
	created_at: string;
}

interface CredentialManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  token: string | null;
  onCredentialsChange?: (credentials: CredentialItem[]) => void;
}

export default function CredentialManagerModal({ isOpen, onClose, projectId, token, onCredentialsChange }: CredentialManagerModalProps) {
  const [credentials, setCredentials] = useState<CredentialItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [name, setName] = useState<string>('');
  const [provider, setProvider] = useState<'AWS' | 'GCP' | 'SSH' | 'GITHUB'>('AWS');
  const [githubToken, setGithubToken] = useState<string>('');
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);

  // AWS Input Parameters
  const [awsAccessKey, setAwsAccessKey] = useState<string>('');
  const [awsSecretKey, setAwsSecretKey] = useState<string>('');
  const [awsRegion, setAwsRegion] = useState<string>('us-east-1');

  // GCP/SSH Raw Private Key Data
  const [rawTextData, setRawTextData] = useState<string>('');
  const [sshUser, setSshUser] = useState<string>('ubuntu');

  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchCredentials = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`http://localhost:8080/api/projects/${projectId}/credentials`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setCredentials(data);
        if (onCredentialsChange) {
          onCredentialsChange(data);
        }
      }
    } catch (err) {
      console.error('Failed to load credentials', err);
    } finally {
      setIsLoading(false);
    }
  }, [projectId, token, onCredentialsChange]);

  useEffect(() => {
    if (isOpen && token) {
      // Fetching on open is the intended synchronization with the credentials API.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchCredentials();
    }
  }, [isOpen, token, fetchCredentials]);

  const handleCreateCredential = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    let payloadData = '';
    if (provider === 'AWS') {
      if (!awsAccessKey.trim() || !awsSecretKey.trim()) {
        setFeedbackMsg({ type: 'error', text: 'AWS Access Key ID and Secret Access Key are required.' });
        return;
      }
      payloadData = JSON.stringify({
        accessKeyId: awsAccessKey.trim(),
        secretAccessKey: awsSecretKey.trim(),
        region: awsRegion.trim()
      });
    } else if (provider === 'SSH') {
      if (!rawTextData.trim()) {
        setFeedbackMsg({ type: 'error', text: 'SSH private key is required.' });
        return;
      }
      payloadData = JSON.stringify({
        private_key: rawTextData.trim(),
        ssh_user: sshUser.trim() || 'ubuntu'
      });
    } else if (provider === 'GITHUB') {
      if (!githubToken.trim()) {
        setFeedbackMsg({ type: 'error', text: 'GitHub Personal Access Token is required.' });
        return;
      }
      payloadData = JSON.stringify({
        token: githubToken.trim()
      });
    } else {
      if (!rawTextData.trim()) {
        setFeedbackMsg({ type: 'error', text: `${provider} key content is required.` });
        return;
      }
      payloadData = rawTextData.trim();
    }

    setIsSaving(true);
    try {
      const res = await fetch(`http://localhost:8080/api/projects/${projectId}/credentials`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: name.trim(),
          provider,
          raw_data: payloadData
        })
      });

      if (res.ok) {
        setFeedbackMsg({ type: 'success', text: 'Credential registered successfully!' });
        setName('');
        setAwsAccessKey('');
        setAwsSecretKey('');
        setRawTextData('');
        setGithubToken('');
        fetchCredentials();
      } else {
        const errText = await res.text();
        setFeedbackMsg({ type: 'error', text: `Failed to save: ${errText}` });
      }
    } catch (err) {
      setFeedbackMsg({ type: 'error', text: 'Network connection failed.' + err });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteCredential = async (credId: string) => {
    if (!confirm('Are you sure you want to revoke and delete this credential?')) return;

    try {
      const res = await fetch(`http://localhost:8080/api/projects/${projectId}/credentials/${credId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        setFeedbackMsg({ type: 'success', text: 'Credential deleted successfully.' });
        fetchCredentials();
      }
    } catch (err) {
      console.error(err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200 text-slate-100 max-h-[85vh] overflow-y-auto">
        
        {/* HEADER */}
        <div className="flex items-center justify-between border-b border-border pb-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Icon icon="lucide:shield-check" className="text-xl" />
            </div>
            <div>
              <h2 className="text-lg font-heading font-semibold text-white">Project Cloud Credentials Vault</h2>
              <p className="text-xs text-slate-400">AES-256 Envelope encrypted environment secrets store</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-secondary transition"
          >
            <Icon icon="lucide:x" className="text-slate-400" />
          </button>
        </div>

        {feedbackMsg && (
          <div className={`mb-6 rounded-xl border p-4 text-sm flex items-center justify-between ${feedbackMsg.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-rose-500/10 border-rose-500/30 text-rose-400'}`}>
            <span>{feedbackMsg.text}</span>
            <button onClick={() => setFeedbackMsg(null)}>
              <Icon icon="lucide:x" />
            </button>
          </div>
        )}

        <div className="grid gap-8 md:grid-cols-2">
          {/* REGISTER CREDENTIALS */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-4">Register New Credential</h3>
            <form onSubmit={handleCreateCredential} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Friendly Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. AWS Production Keys"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-primary/50"
                />
              </div>

              <div className="relative">
                <label className="block text-xs text-slate-400 mb-1">Cloud Provider / Key Type</label>
                <button
                  type="button"
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  className="flex w-full items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-sm text-slate-100 focus:border-primary/50"
                >
                  <span className="flex items-center gap-2">
                    {provider === 'AWS' && <Icon icon="logos:aws" className="text-base" />}
                    {provider === 'GCP' && <Icon icon="logos:google-cloud" className="text-base" />}
                    {provider === 'SSH' && <Icon icon="lucide:key" className="text-primary text-base" />}
                    {provider === 'GITHUB' && <Icon icon="logos:github-icon" className="text-base filter invert dark:invert-0" />}
                    {provider === 'AWS' && 'Amazon Web Services (AWS)'}
                    {provider === 'GCP' && 'Google Cloud Platform (GCP)'}
                    {provider === 'SSH' && 'SSH Private Key (.pem)'}
                    {provider === 'GITHUB' && 'GitHub Personal Access Token'}
                  </span>
                  <Icon icon="lucide:chevron-down" className={`text-slate-400 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {isDropdownOpen && (
                  <div className="absolute top-full left-0 z-20 mt-1 w-full rounded-lg border border-border bg-background p-1 shadow-xl">
                    <button
                      type="button"
                      onClick={() => { setProvider('AWS'); setIsDropdownOpen(false); }}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-card text-left"
                    >
                      <Icon icon="logos:aws" /> AWS Access Keys
                    </button>
                    <button
                      type="button"
                      onClick={() => { setProvider('GCP'); setIsDropdownOpen(false); }}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-card text-left"
                    >
                      <Icon icon="logos:google-cloud" /> GCP Service Account JSON
                    </button>
                    <button
                      type="button"
                      onClick={() => { setProvider('SSH'); setIsDropdownOpen(false); }}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-card text-left"
                    >
                      <Icon icon="lucide:key" className="text-primary" /> SSH PEM Private Key
                    </button>
                    <button
                      type="button"
                      onClick={() => { setProvider('GITHUB'); setIsDropdownOpen(false); }}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-card text-left"
                    >
                      <Icon icon="logos:github-icon" className="filter invert dark:invert-0" /> GitHub PAT
                    </button>
                  </div>
                )}
              </div>

              {provider === 'AWS' && (
                <div className="space-y-3 p-3 rounded-lg bg-background/50 border border-border">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">AWS Access Key ID</label>
                    <input
                      type="text"
                      value={awsAccessKey}
                      onChange={(e) => setAwsAccessKey(e.target.value)}
                      placeholder="AKIA..."
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-slate-100 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">AWS Secret Access Key</label>
                    <input
                      type="password"
                      value={awsSecretKey}
                      onChange={(e) => setAwsSecretKey(e.target.value)}
                      placeholder="••••••••••••••••••••••••••••••••"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-slate-100 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">AWS Default Region</label>
                    <input
                      type="text"
                      value={awsRegion}
                      onChange={(e) => setAwsRegion(e.target.value)}
                      placeholder="us-east-1"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-slate-100 outline-none"
                    />
                  </div>
                </div>
              )}

              {provider === 'GCP' && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">GCP Service Account JSON</label>
                  <textarea
                    rows={6}
                    value={rawTextData}
                    onChange={(e) => setRawTextData(e.target.value)}
                    placeholder='{ "type": "service_account", "project_id": "...", ... }'
                    className="w-full rounded-lg border border-border bg-background p-3 text-xs font-mono text-primary outline-none resize-none"
                  />
                </div>
              )}

              {provider === 'SSH' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">SSH Username</label>
                    <input
                      type="text"
                      value={sshUser}
                      onChange={(e) => setSshUser(e.target.value)}
                      placeholder="ubuntu"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-slate-100 outline-none focus:border-primary/50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">SSH PEM Private Key content</label>
                    <textarea
                      rows={6}
                      value={rawTextData}
                      onChange={(e) => setRawTextData(e.target.value)}
                      placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;...&#10;-----END RSA PRIVATE KEY-----"
                      className="w-full rounded-lg border border-border bg-background p-3 text-xs font-mono text-slate-300 outline-none resize-none focus:border-primary/50"
                    />
                  </div>
                </div>
              )}

              {provider === 'GITHUB' && (
                <div className="space-y-3 p-3 rounded-lg bg-background/50 border border-border">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">GitHub Personal Access Token (PAT)</label>
                    <input
                      type="password"
                      required
                      value={githubToken}
                      onChange={(e) => setGithubToken(e.target.value)}
                      placeholder="ghp_..."
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-slate-100 outline-none focus:border-primary/50"
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={isSaving}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary hover:bg-primary/90 py-2.5 text-sm font-semibold text-primary-foreground shadow-md transition disabled:opacity-50 cursor-pointer"
              >
                {isSaving ? (
                  <>
                    <Icon icon="lucide:loader-2" className="animate-spin text-base" />
                    Encrypting & Saving...
                  </>
                ) : (
                  'Save Encrypted Secret'
                )}
              </button>
            </form>
          </div>

          {/* CREDENTIALS LIST */}
          <div className="flex flex-col">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-4">Active Credentials</h3>
            {isLoading ? (
              <div className="flex flex-1 items-center justify-center">
                <Icon icon="lucide:loader-2" className="animate-spin text-2xl text-primary" />
              </div>
            ) : credentials.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border p-8 text-center text-slate-500">
                <Icon icon="lucide:key" className="text-3xl mb-2" />
                <p className="text-sm">No credentials registered for this project.</p>
              </div>
            ) : (
              <div className="space-y-3 overflow-y-auto max-h-[45vh] pr-2">
                {credentials.map((cred) => (
                  <div key={cred.id} className="flex items-center justify-between rounded-xl border border-border bg-background/40 p-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-1">
                        {cred.provider === 'AWS' && <Icon icon="logos:aws" className="text-lg" />}
                        {cred.provider === 'GCP' && <Icon icon="logos:google-cloud" className="text-lg" />}
                        {cred.provider === 'SSH' && <Icon icon="lucide:key" className="text-primary text-lg" />}
                        {cred.provider === 'GITHUB' && <Icon icon="logos:github-icon" className="text-lg filter invert dark:invert-0" />}
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-white">{cred.name}</h4>
                        <p className="text-xs text-slate-500 font-mono mt-0.5">{cred.key_fingerprint}</p>
                        <p className="text-[10px] text-slate-600 mt-1">Saved: {new Date(cred.created_at).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteCredential(cred.id)}
                      className="rounded-lg p-2 hover:bg-secondary hover:text-rose-500 transition text-slate-500"
                    >
                      <Icon icon="lucide:trash-2" className="text-base" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface CredentialManagerTabProps {
  projectId: string;
  token: string | null;
  onCredentialsChange?: (credentials: CredentialItem[]) => void;
}

export function CredentialManagerTab({ projectId, token, onCredentialsChange }: CredentialManagerTabProps) {
  const [credentials, setCredentials] = useState<CredentialItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [name, setName] = useState<string>('');
  const [provider, setProvider] = useState<'AWS' | 'GCP' | 'SSH' | 'GITHUB'>('AWS');
  const [githubToken, setGithubToken] = useState<string>('');
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);

  // AWS Input Parameters
  const [awsAccessKey, setAwsAccessKey] = useState<string>('');
  const [awsSecretKey, setAwsSecretKey] = useState<string>('');
  const [awsRegion, setAwsRegion] = useState<string>('us-east-1');

  // GCP/SSH Raw Private Key Data
  const [rawTextData, setRawTextData] = useState<string>('');
  const [sshUser, setSshUser] = useState<string>('ubuntu');
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchCredentials = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`http://localhost:8080/api/projects/${projectId}/credentials`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setCredentials(data);
        if (onCredentialsChange) {
          onCredentialsChange(data);
        }
      }
    } catch (err) {
      console.error('Failed to load credentials', err);
    } finally {
      setIsLoading(false);
    }
  }, [projectId, token, onCredentialsChange]);

  useEffect(() => {
    if (projectId && token) {
      // Fetching on mount/prop change is the intended synchronization with the credentials API.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchCredentials();
    }
  }, [projectId, token, fetchCredentials]);

  const handleCreateCredential = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    let payloadData = '';
    if (provider === 'AWS') {
      if (!awsAccessKey.trim() || !awsSecretKey.trim()) {
        setFeedbackMsg({ type: 'error', text: 'AWS Access Key ID and Secret Access Key are required.' });
        return;
      }
      payloadData = JSON.stringify({
        accessKeyId: awsAccessKey.trim(),
        secretAccessKey: awsSecretKey.trim(),
        region: awsRegion.trim()
      });
    } else if (provider === 'SSH') {
      if (!rawTextData.trim()) {
        setFeedbackMsg({ type: 'error', text: 'SSH private key is required.' });
        return;
      }
      payloadData = JSON.stringify({
        private_key: rawTextData.trim(),
        ssh_user: sshUser.trim() || 'ubuntu'
      });
    } else if (provider === 'GITHUB') {
      if (!githubToken.trim()) {
        setFeedbackMsg({ type: 'error', text: 'GitHub Personal Access Token is required.' });
        return;
      }
      payloadData = JSON.stringify({
        token: githubToken.trim()
      });
    } else {
      if (!rawTextData.trim()) {
        setFeedbackMsg({ type: 'error', text: `${provider} key content is required.` });
        return;
      }
      payloadData = rawTextData.trim();
    }

    setIsSaving(true);
    try {
      const res = await fetch(`http://localhost:8080/api/projects/${projectId}/credentials`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: name.trim(),
          provider,
          raw_data: payloadData
        })
      });

      if (res.ok) {
        setFeedbackMsg({ type: 'success', text: 'Credential registered successfully!' });
        setName('');
        setAwsAccessKey('');
        setAwsSecretKey('');
        setRawTextData('');
        setGithubToken('');
        fetchCredentials();
      } else {
        const errText = await res.text();
        setFeedbackMsg({ type: 'error', text: `Failed to save: ${errText}` });
      }
    } catch (err) {
      setFeedbackMsg({ type: 'error', text: 'Network connection failed.' + err });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteCredential = async (credId: string) => {
    if (!confirm('Are you sure you want to revoke and delete this credential?')) return;

    try {
      const res = await fetch(`http://localhost:8080/api/projects/${projectId}/credentials/${credId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        setFeedbackMsg({ type: 'success', text: 'Credential deleted successfully.' });
        fetchCredentials();
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="w-full text-slate-100">
      {feedbackMsg && (
        <div className={`mb-6 rounded-xl border p-4 text-sm flex items-center justify-between ${feedbackMsg.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-rose-500/10 border-rose-500/30 text-rose-400'}`}>
          <span>{feedbackMsg.text}</span>
          <button onClick={() => setFeedbackMsg(null)}>
            <Icon icon="lucide:x" />
          </button>
        </div>
      )}

      <div className="grid gap-8 md:grid-cols-2">
        {/* REGISTER CREDENTIALS */}
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-4">Register New Credential</h3>
          <form onSubmit={handleCreateCredential} className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Friendly Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. AWS Production Keys"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-primary/50"
              />
            </div>

            <div className="relative">
              <label className="block text-xs text-slate-400 mb-1">Cloud Provider / Key Type</label>
              <button
                type="button"
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="flex w-full items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-sm text-slate-100 focus:border-primary/50"
              >
                <span className="flex items-center gap-2">
                  {provider === 'AWS' && <Icon icon="logos:aws" className="text-base" />}
                  {provider === 'GCP' && <Icon icon="logos:google-cloud" className="text-base" />}
                  {provider === 'SSH' && <Icon icon="lucide:key" className="text-primary text-base" />}
                  {provider === 'GITHUB' && <Icon icon="logos:github-icon" className="text-base filter invert dark:invert-0" />}
                  {provider === 'AWS' && 'Amazon Web Services (AWS)'}
                  {provider === 'GCP' && 'Google Cloud Platform (GCP)'}
                  {provider === 'SSH' && 'SSH Private Key (.pem)'}
                  {provider === 'GITHUB' && 'GitHub Personal Access Token'}
                </span>
                <Icon icon="lucide:chevron-down" className={`text-slate-400 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {isDropdownOpen && (
                <div className="absolute top-full left-0 z-20 mt-1 w-full rounded-lg border border-border bg-background p-1 shadow-xl">
                  <button
                    type="button"
                    onClick={() => { setProvider('AWS'); setIsDropdownOpen(false); }}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-card text-left"
                  >
                    <Icon icon="logos:aws" /> AWS Access Keys
                  </button>
                  <button
                    type="button"
                    onClick={() => { setProvider('GCP'); setIsDropdownOpen(false); }}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-card text-left"
                  >
                    <Icon icon="logos:google-cloud" /> GCP Service Account JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => { setProvider('SSH'); setIsDropdownOpen(false); }}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-card text-left"
                  >
                    <Icon icon="lucide:key" className="text-primary" /> SSH PEM Private Key
                  </button>
                  <button
                    type="button"
                    onClick={() => { setProvider('GITHUB'); setIsDropdownOpen(false); }}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-card text-left"
                  >
                    <Icon icon="logos:github-icon" className="filter invert dark:invert-0" /> GitHub PAT
                  </button>
                </div>
              )}
            </div>

            {provider === 'AWS' && (
              <div className="space-y-3 p-3 rounded-lg bg-background/50 border border-border">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">AWS Access Key ID</label>
                  <input
                    type="text"
                    value={awsAccessKey}
                    onChange={(e) => setAwsAccessKey(e.target.value)}
                    placeholder="AKIA..."
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-slate-100 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">AWS Secret Access Key</label>
                  <input
                    type="password"
                    value={awsSecretKey}
                    onChange={(e) => setAwsSecretKey(e.target.value)}
                    placeholder="••••••••••••••••••••••••••••••••"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-slate-100 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">AWS Default Region</label>
                  <input
                    type="text"
                    value={awsRegion}
                    onChange={(e) => setAwsRegion(e.target.value)}
                    placeholder="us-east-1"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-slate-100 outline-none"
                  />
                </div>
              </div>
            )}

            {provider === 'GCP' && (
              <div>
                <label className="block text-xs text-slate-400 mb-1">GCP Service Account JSON</label>
                <textarea
                  rows={6}
                  value={rawTextData}
                  onChange={(e) => setRawTextData(e.target.value)}
                  placeholder='{ "type": "service_account", "project_id": "...", ... }'
                  className="w-full rounded-lg border border-border bg-background p-3 text-xs font-mono text-primary outline-none resize-none"
                />
              </div>
            )}

            {provider === 'SSH' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">SSH Username</label>
                  <input
                    type="text"
                    value={sshUser}
                    onChange={(e) => setSshUser(e.target.value)}
                    placeholder="ubuntu"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-slate-100 outline-none focus:border-primary/50"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">SSH PEM Private Key content</label>
                  <textarea
                    rows={6}
                    value={rawTextData}
                    onChange={(e) => setRawTextData(e.target.value)}
                    placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;...&#10;-----END RSA PRIVATE KEY-----"
                    className="w-full rounded-lg border border-border bg-background p-3 text-xs font-mono text-slate-300 outline-none resize-none focus:border-primary/50"
                  />
                </div>
              </div>
            )}

            {provider === 'GITHUB' && (
              <div className="space-y-3 p-3 rounded-lg bg-background/50 border border-border">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">GitHub Personal Access Token (PAT)</label>
                  <input
                    type="password"
                    required
                    value={githubToken}
                    onChange={(e) => setGithubToken(e.target.value)}
                    placeholder="ghp_..."
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-slate-100 outline-none focus:border-primary/50"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isSaving}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary hover:bg-primary/90 py-2.5 text-sm font-semibold text-primary-foreground shadow-md transition disabled:opacity-50 cursor-pointer"
            >
              {isSaving ? (
                <>
                  <Icon icon="lucide:loader-2" className="animate-spin text-base" />
                  Encrypting & Saving...
                </>
              ) : (
                'Save Encrypted Secret'
              )}
            </button>
          </form>
        </div>

        {/* CREDENTIALS LIST */}
        <div className="flex flex-col">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-4">Active Credentials</h3>
          {isLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <Icon icon="lucide:loader-2" className="animate-spin text-2xl text-primary" />
            </div>
          ) : credentials.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border p-8 text-center text-slate-500">
              <Icon icon="lucide:key" className="text-3xl mb-2" />
              <p className="text-sm">No credentials registered for this project.</p>
            </div>
          ) : (
            <div className="space-y-3 overflow-y-auto max-h-[45vh] pr-2">
              {credentials.map((cred) => (
                <div key={cred.id} className="flex items-center justify-between rounded-xl border border-border bg-background/40 p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-1">
                      {cred.provider === 'AWS' && <Icon icon="logos:aws" className="text-lg" />}
                      {cred.provider === 'GCP' && <Icon icon="logos:google-cloud" className="text-lg" />}
                      {cred.provider === 'SSH' && <Icon icon="lucide:key" className="text-primary text-lg" />}
                      {cred.provider === 'GITHUB' && <Icon icon="logos:github-icon" className="text-lg filter invert dark:invert-0" />}
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-white">{cred.name}</h4>
                      <p className="text-xs text-slate-500 font-mono mt-0.5">{cred.key_fingerprint}</p>
                      <p className="text-[10px] text-slate-600 mt-1">Saved: {new Date(cred.created_at).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteCredential(cred.id)}
                    className="rounded-lg p-2 hover:bg-secondary hover:text-rose-500 transition text-slate-500"
                  >
                    <Icon icon="lucide:trash-2" className="text-base" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
