'use client';

import React, { useEffect, useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { Icon } from '@iconify/react';
import { useAuthStore } from '../store/useAuthStore';
import ProfileMenu from '../components/ProfileMenu';
import { BlueprintCorners } from '../components/ui/BlueprintCorners';
import { THEME_PALETTES, type Theme } from '../components/ui/theme-palette';
import { spaceGroteskFont, barlowFont, jetBrainsMonoFont } from '../fonts';
import { BrandLogo } from '../components/brand/BrandLogo';
import '../components/ui/blueprint.css';
import './docs.css';

function CodeBlock({ code }: { code: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  const legacyCopy = (text: string) => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  };

  const handleCopy = async () => {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
        ok = true;
      } else {
        ok = legacyCopy(code);
      }
    } catch {
      ok = legacyCopy(code);
    }
    setStatus(ok ? 'copied' : 'error');
    setTimeout(() => setStatus('idle'), 1600);
  };

  return (
    <div style={{ position: 'relative' }}>
      <pre
        style={{
          margin: 0,
          background: '#17181C',
          border: '1px solid #2A2C33',
          padding: '14px 44px 14px 16px',
          fontFamily: 'var(--font-mono-marketing), monospace',
          fontSize: 12.5,
          lineHeight: 1.7,
          color: '#E7E9F3',
          overflowX: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {code}
      </pre>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={status === 'copied' ? 'Copied' : status === 'error' ? 'Copy failed' : 'Copy command'}
        title={status === 'error' ? 'Copy failed — select the text manually' : undefined}
        className="wp-docs-copybtn"
        style={{
          position: 'absolute',
          top: 10,
          right: 10,
          width: 26,
          height: 26,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: `1px solid ${status === 'copied' ? 'rgba(16,185,129,.4)' : status === 'error' ? 'rgba(244,63,94,.4)' : '#2A2C33'}`,
          background: status === 'copied' ? 'rgba(16,185,129,.1)' : status === 'error' ? 'rgba(244,63,94,.1)' : 'transparent',
          color: status === 'copied' ? '#10B981' : status === 'error' ? '#F43F5E' : '#A3A6AF',
          cursor: 'pointer',
        }}
      >
        <Icon icon={status === 'copied' ? 'lucide:check' : status === 'error' ? 'lucide:x' : 'lucide:copy'} width={12} />
      </button>
    </div>
  );
}

function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code style={{ fontFamily: 'var(--font-mono-marketing), monospace', fontSize: 12, background: 'var(--elevated)', color: 'var(--ink)', padding: '1px 5px' }}>
      {children}
    </code>
  );
}

const h2Style: CSSProperties = {
  margin: '28px 0 10px',
  fontFamily: 'var(--font-display)',
  fontWeight: 600,
  fontSize: 20,
  color: 'var(--ink)',
};

const bodyStyle: CSSProperties = { margin: 0, fontSize: 14.5, lineHeight: 1.65, color: 'var(--ink2)' };

const cardStyle: CSSProperties = { position: 'relative', background: 'var(--panel)', padding: '18px 20px' };

type CLIReleaseAsset = { name: string; url: string; size: number };
type CLIRelease = {
  version: string;
  tag: string;
  publishedAt: string;
  prerelease: boolean;
  htmlUrl: string;
  assets: CLIReleaseAsset[];
};

const NAV_SECTIONS: { group: string; items: { id: string; label: string }[] }[] = [
  {
    group: 'Getting Started',
    items: [
      { id: 'intro', label: 'Introduction' },
      { id: 'install', label: 'Installation Guide' },
    ],
  },
  {
    group: 'Local Sandbox Agent',
    items: [
      { id: 'sandbox-intro', label: 'Why a Local Sandbox?' },
      { id: 'sandbox-setup', label: 'Setup & Pairing' },
      { id: 'sandbox-commands', label: 'Command Reference' },
      { id: 'sandbox-troubleshooting', label: 'Troubleshooting' },
    ],
  },
  {
    group: 'CLI Commands',
    items: [
      { id: 'auth', label: 'Authentication' },
      { id: 'projects', label: 'Projects CRUD' },
      { id: 'import', label: 'Importing Code' },
      { id: 'deploy', label: 'Deploy & Runs' },
    ],
  },
];

const SECTION_TOC: Record<string, { id: string; label: string }[]> = {
  intro: [{ id: 'intro-capabilities', label: 'Main Capabilities' }],
  install: [
    { id: 'install-download', label: 'Download the Installer' },
    { id: 'install-steps', label: 'Install Steps' },
  ],
  'sandbox-intro': [
    { id: 'sandbox-intro-changes', label: 'What Actually Changes' },
    { id: 'sandbox-intro-docker', label: 'Docker Desktop Licensing' },
  ],
  'sandbox-setup': [
    { id: 'sandbox-setup-login', label: '1. Log In' },
    { id: 'sandbox-setup-enable', label: '2. Enable the Agent' },
    { id: 'sandbox-setup-up', label: '3. Bring Up the Sandbox' },
    { id: 'sandbox-setup-deploy', label: '4. Deploy From the Canvas' },
    { id: 'sandbox-setup-nosetup', label: 'No Setup Needed' },
    { id: 'sandbox-setup-selfhost', label: 'Self-Hosting' },
  ],
  'sandbox-commands': [
    { id: 'sandbox-cmd-status', label: 'Check Connection Status' },
    { id: 'sandbox-cmd-pause', label: 'Pause the Sandbox' },
    { id: 'sandbox-cmd-retire', label: 'Retire an Agent' },
    { id: 'sandbox-cmd-service', label: 'Run as a Service' },
    { id: 'sandbox-cmd-manage', label: 'Managing Paired Agents' },
  ],
  'sandbox-troubleshooting': [
    { id: 'ts-beta', label: 'Opt-in Beta Flag' },
    { id: 'ts-pending', label: 'Stuck on PENDING' },
    { id: 'ts-disconnected', label: 'DISCONNECTED, Deploys Rejected' },
    { id: 'ts-not-connected', label: 'Agent Not Connected' },
    { id: 'ts-migration', label: 'Free-tier Migration' },
    { id: 'ts-docker', label: 'Docker Daemon Not Found' },
  ],
  auth: [
    { id: 'auth-login', label: 'Login' },
    { id: 'auth-logout', label: 'Logout' },
  ],
  projects: [
    { id: 'projects-list', label: 'List Projects' },
    { id: 'projects-create', label: 'Create a Project' },
    { id: 'projects-delete', label: 'Delete a Project' },
  ],
  import: [
    { id: 'import-file', label: 'Import a Single File' },
    { id: 'import-dir', label: 'Import a Directory' },
  ],
  deploy: [
    { id: 'deploy-run', label: 'Execute Deployment Pipeline' },
    { id: 'deploy-autodestroy', label: 'Deploy With Auto-Destroy' },
  ],
};

const scrollToId = (id: string) => {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

export function DocsPageV2() {
  const { user, hasHydrated } = useAuthStore();
  const isLoggedIn = hasHydrated && !!user;

  const [theme, setTheme] = useState<Theme>('dark');
  const [activeTab, setActiveTab] = useState<'windows' | 'macos' | 'linux'>('windows');
  const [activeSection, setActiveSection] = useState<string>('intro');

  // `releases` stays null while loading and becomes [] on a failed fetch or
  // if nothing's been tagged yet — both cases fall back to the static
  // "latest" links below rather than showing a picker with nothing to pick.
  const [releases, setReleases] = useState<CLIRelease[] | null>(null);
  const [selectedTag, setSelectedTag] = useState<string>('latest');

  const API_URL = (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_URL) || 'http://localhost:8080';
  const downloadBaseUrl = `${API_URL}/downloads`;

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/cli/releases`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`status ${res.status}`))))
      .then((data: CLIRelease[]) => {
        if (!cancelled) setReleases(data);
      })
      .catch(() => {
        if (!cancelled) setReleases([]);
      });
    return () => {
      cancelled = true;
    };
  }, [API_URL]);

  const downloadLinks = {
    windowsInstaller: `${downloadBaseUrl}/whiparc-setup-windows-amd64.exe`,
    macosInstaller: `${downloadBaseUrl}/whiparc-macos.pkg`,
    linuxInstallScript: `${downloadBaseUrl}/install.sh`,
    windows: `${downloadBaseUrl}/whiparc-windows-amd64.exe`,
    macosSilicon: `${downloadBaseUrl}/whiparc-darwin-arm64`,
    macosIntel: `${downloadBaseUrl}/whiparc-darwin-amd64`,
    linux: `${downloadBaseUrl}/whiparc-linux-amd64`,
  };

  // Latest always uses the local-serve-with-GitHub-fallback proxy above
  // (downloadLinks) — that proxy only ever tracks the newest build, so a
  // specific previous/beta version instead resolves straight to that
  // release's own GitHub asset URL.
  const stableReleases = (releases ?? []).filter((r) => !r.prerelease);
  const betaReleases = (releases ?? []).filter((r) => r.prerelease);
  const latestRelease = stableReleases[0];
  const previousReleases = stableReleases.slice(1);
  const selectedRelease = selectedTag === 'latest' ? undefined : (releases ?? []).find((r) => r.tag === selectedTag);
  const selectedReleaseInfo = selectedTag === 'latest' ? latestRelease : selectedRelease;

  const assetUrl = (filename: string, fallback: string) =>
    selectedRelease?.assets.find((a) => a.name === filename)?.url ?? fallback;

  const activeLinks = {
    windowsInstaller: assetUrl('whiparc-setup-windows-amd64.exe', downloadLinks.windowsInstaller),
    macosInstaller: assetUrl('whiparc-macos.pkg', downloadLinks.macosInstaller),
    linuxInstallScript: assetUrl('install.sh', downloadLinks.linuxInstallScript),
    windows: assetUrl('whiparc-windows-amd64.exe', downloadLinks.windows),
    macosSilicon: assetUrl('whiparc-darwin-arm64', downloadLinks.macosSilicon),
    macosIntel: assetUrl('whiparc-darwin-amd64', downloadLinks.macosIntel),
    linux: assetUrl('whiparc-linux-amd64', downloadLinks.linux),
  };

  const palette = THEME_PALETTES[theme];
  const rootVars = useMemo(
    () =>
      ({
        ...palette,
        background: palette['--ground'],
        color: palette['--ink'],
      }) as CSSProperties,
    [palette]
  );

  const toc = SECTION_TOC[activeSection] ?? [];

  return (
    <div
      className={`${spaceGroteskFont.variable} ${barlowFont.variable} ${jetBrainsMonoFont.variable}`}
      style={{ ...rootVars, minHeight: '100vh', fontSize: 15, lineHeight: 1.55, transition: 'background .3s ease, color .3s ease', fontFamily: 'var(--font-body-marketing), system-ui, sans-serif' }}
    >
      {/* HEADER */}
      <header style={{ height: 56, display: 'flex', alignItems: 'center', gap: 16, padding: '0 clamp(16px,3vw,28px)', borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, background: 'var(--ground)', zIndex: 20 }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 9, flex: 'none' }}>
          <BrandLogo size={24} style={{ color: 'var(--ink)' }} />
          <span style={{ fontFamily: 'var(--font-mono-marketing)', fontSize: 10, color: 'var(--ink3)', borderLeft: '1px solid var(--line)', paddingLeft: 10, marginLeft: 2 }}>docs</span>
        </Link>

        <div className="wp-docs-search" style={{ flex: 1, maxWidth: 360, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', height: 32, border: '1px solid var(--line)' }}>
          <Icon icon="lucide:search" width={13} style={{ color: 'var(--ink3)', flexShrink: 0 }} />
          <input
            placeholder="Search docs"
            className="wp-docs-input"
            style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', fontSize: 13, color: 'var(--ink)', fontFamily: 'var(--font-body-marketing), sans-serif' }}
          />
          <span style={{ fontFamily: 'var(--font-mono-marketing)', fontSize: 10, color: 'var(--ink3)', border: '1px solid var(--line)', padding: '1px 4px', flexShrink: 0 }}>⌘K</span>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
            title="Toggle theme"
            className="wp-docs-iconbtn"
            style={{ width: 30, height: 30, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink2)', cursor: 'pointer' }}
          >
            <Icon icon={theme === 'light' ? 'lucide:moon' : 'lucide:sun'} width={14} />
          </button>
          <a
            href="https://github.com/whiparc/whiparc"
            target="_blank"
            rel="noreferrer"
            className="wp-docs-navlink"
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink2)' }}
          >
            <Icon icon="mdi:github" width={15} />
            <span className="wp-docs-github-label">GitHub</span>
          </a>
          {isLoggedIn ? (
            <>
              <Link
                href="/dashboard"
                className="wp-docs-submit"
                style={{ height: 30, padding: '0 13px', display: 'flex', alignItems: 'center', fontSize: 13, fontWeight: 500, background: 'var(--accent)', color: 'var(--on-accent)', border: 0 }}
              >
                Dashboard
              </Link>
              <ProfileMenu blueprint />
            </>
          ) : (
            <Link href="/login" style={{ padding: '5px 12px', border: '1px solid var(--line)', color: 'var(--ink)', fontSize: 13 }}>
              Sign In
            </Link>
          )}
        </div>
      </header>

      {/* BODY */}
      <div className="wp-docs-layout" style={{ maxWidth: 1180, margin: '0 auto', display: 'grid', gridTemplateColumns: '216px minmax(0,1fr) 200px', gap: 36, padding: '28px clamp(16px,3vw,28px) 64px' }}>
        {/* LEFT NAV */}
        <nav className="wp-docs-sidenav">
          {NAV_SECTIONS.map((group) => (
            <div key={group.group} style={{ marginBottom: 18 }}>
              <p style={{ margin: '0 0 8px', fontFamily: 'var(--font-mono-marketing)', fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink3)' }}>
                {group.group}
              </p>
              {group.items.map((item) => {
                const active = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveSection(item.id)}
                    className={active ? undefined : 'wp-docs-navlink'}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '5px 9px',
                      marginBottom: 1,
                      border: 0,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      fontSize: 13.5,
                      color: active ? 'var(--on-accent)' : 'var(--ink2)',
                      background: active ? 'var(--accent)' : 'transparent',
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* ARTICLE */}
        <main style={{ minWidth: 0 }}>
          {activeSection === 'intro' && (
            <section>
              <p style={{ margin: 0, fontFamily: 'var(--font-mono-marketing)', fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--accent-ink)' }}>Getting started</p>
              <h1 style={{ margin: '8px 0 0', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,34px)', letterSpacing: '-.01em', color: 'var(--ink)' }}>Whiparc CLI</h1>
              <p style={{ margin: '14px 0 0', fontSize: 15.5, lineHeight: 1.65, color: 'var(--ink2)', maxWidth: '38em' }}>
                The Whiparc Command-Line Interface (<InlineCode>whiparc</InlineCode>) is a powerful tool designed to integrate visual configuration layouts directly with native infrastructure-as-code manifests. With the CLI, platform teams can synchronize local directories, query workspace settings, and stream deployment pipelines from their local terminals or CI/CD pipelines.
              </p>

              <div id="intro-capabilities" className="wp-blueprint" style={{ ...cardStyle, marginTop: 26 }}>
                <BlueprintCorners />
                <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, color: 'var(--ink)' }}>Main Capabilities</h3>
                <ul style={{ margin: '14px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 12 }}>
                  <li style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <Icon icon="lucide:check-circle-2" width={16} style={{ color: 'var(--accent-ink)', marginTop: 2, flexShrink: 0 }} />
                    <span style={{ fontSize: 13.5, color: 'var(--ink2)' }}>
                      <strong style={{ color: 'var(--ink)' }}>Code Reverse-Parsing</strong>: Recursively parse Terraform HCL, Ansible YAML, and Kubernetes manifests into canvas visual blocks.
                    </span>
                  </li>
                  <li style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <Icon icon="lucide:check-circle-2" width={16} style={{ color: 'var(--accent-ink)', marginTop: 2, flexShrink: 0 }} />
                    <span style={{ fontSize: 13.5, color: 'var(--ink2)' }}>
                      <strong style={{ color: 'var(--ink)' }}>Live WebSocket Sync</strong>: Sync changes locally and see the browser visual canvas update in real-time.
                    </span>
                  </li>
                  <li style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <Icon icon="lucide:check-circle-2" width={16} style={{ color: 'var(--accent-ink)', marginTop: 2, flexShrink: 0 }} />
                    <span style={{ fontSize: 13.5, color: 'var(--ink2)' }}>
                      <strong style={{ color: 'var(--ink)' }}>Deployment Logs Stream</strong>: Pipe pipeline output straight to terminal stdout.
                    </span>
                  </li>
                </ul>
              </div>

              <div style={{ marginTop: 24 }}>
                <button type="button" onClick={() => setActiveSection('install')} className="wp-docs-submit" style={{ height: 38, padding: '0 20px', display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontFamily: 'var(--font-display)', fontWeight: 600, background: 'var(--accent)', color: 'var(--on-accent)', border: 0, cursor: 'pointer' }}>
                  Proceed to Installation
                  <Icon icon="lucide:arrow-right" width={14} />
                </button>
              </div>
            </section>
          )}

          {activeSection === 'install' && (
            <section>
              <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,34px)', letterSpacing: '-.01em', color: 'var(--ink)' }}>Installation Guide</h1>
              <p style={{ margin: '14px 0 0', ...bodyStyle }}>
                Download the one-click installer for your platform — it places the <InlineCode>whiparc</InlineCode> binary and adds it to your PATH automatically, so <InlineCode>whiparc</InlineCode> works from any new terminal with no manual setup.
              </p>

              <div id="install-download" className="wp-blueprint" style={{ ...cardStyle, marginTop: 26 }}>
                <BlueprintCorners />
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ width: 44, height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--accent)', color: 'var(--accent-ink)' }}>
                    <Icon icon="lucide:download-cloud" width={20} />
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, color: 'var(--ink)' }}>Download the Installer</h3>
                    <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--ink3)' }}>Always built from the latest stable CLI changes. Unsigned — see the platform notes below.</p>
                  </div>
                </div>

                {releases !== null && releases.length > 0 && (
                  <div style={{ marginTop: 18 }}>
                    <label htmlFor="cli-version" style={{ display: 'block', margin: '0 0 6px', fontSize: 11, color: 'var(--ink3)' }}>
                      Version
                    </label>
                    <select
                      id="cli-version"
                      value={selectedTag}
                      onChange={(e) => setSelectedTag(e.target.value)}
                      className="wp-docs-input"
                      style={{ width: '100%', height: 36, padding: '0 10px', border: '1px solid var(--line)', background: 'var(--elevated)', color: 'var(--ink)', fontSize: 13, cursor: 'pointer' }}
                    >
                      {latestRelease && (
                        <optgroup label="Latest">
                          <option value="latest">v{latestRelease.version} (latest)</option>
                        </optgroup>
                      )}
                      {previousReleases.length > 0 && (
                        <optgroup label="Previous Versions">
                          {previousReleases.map((r) => (
                            <option key={r.tag} value={r.tag}>
                              v{r.version}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {betaReleases.length > 0 && (
                        <optgroup label="Beta">
                          {betaReleases.map((r) => (
                            <option key={r.tag} value={r.tag}>
                              v{r.version} (beta)
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    {selectedReleaseInfo && (
                      <p style={{ margin: '8px 0 0', fontSize: 11.5, color: 'var(--ink3)' }}>
                        Published{' '}
                        {new Date(selectedReleaseInfo.publishedAt).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                        {' · '}
                        <a href={selectedReleaseInfo.htmlUrl} target="_blank" rel="noreferrer" className="wp-docs-toclink" style={{ color: 'var(--accent-ink)' }}>
                          Release notes
                        </a>
                      </p>
                    )}
                  </div>
                )}

                {isLoggedIn ? (
                  <div className="wp-docs-download-grid" style={{ marginTop: 20, display: 'grid', gap: 10 }}>
                    <a href={activeLinks.windowsInstaller} download className="wp-docs-navlink" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid var(--line)', padding: '12px 14px', fontSize: 13, color: 'var(--ink)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Icon icon="logos:microsoft-windows" width={15} />
                        Windows
                      </span>
                      <Icon icon="lucide:arrow-down-to-line" width={13} style={{ color: 'var(--ink3)' }} />
                    </a>
                    <a href={activeLinks.macosInstaller} download className="wp-docs-navlink" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid var(--line)', padding: '12px 14px', fontSize: 13, color: 'var(--ink)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Icon icon="logos:apple" width={15} style={{ color: 'var(--ink)' }} />
                        macOS (Universal)
                      </span>
                      <Icon icon="lucide:arrow-down-to-line" width={13} style={{ color: 'var(--ink3)' }} />
                    </a>
                    <a href={activeLinks.linuxInstallScript} download className="wp-docs-navlink" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid var(--line)', padding: '12px 14px', fontSize: 13, color: 'var(--ink)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Icon icon="logos:linux-tux" width={15} />
                        Linux (install.sh)
                      </span>
                      <Icon icon="lucide:arrow-down-to-line" width={13} style={{ color: 'var(--ink3)' }} />
                    </a>
                  </div>
                ) : (
                  <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '1px dashed var(--line)', background: 'var(--ground)', padding: 24, textAlign: 'center' }}>
                    <Icon icon="lucide:lock" width={26} style={{ color: 'var(--ink3)', marginBottom: 8 }} />
                    <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--ink2)' }}>You must be logged in to download compiled binaries.</p>
                    <Link href="/login" className="wp-docs-submit" style={{ height: 32, padding: '0 16px', display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 600, background: 'var(--accent)', color: 'var(--on-accent)' }}>
                      Sign In to Download
                    </Link>
                  </div>
                )}
              </div>

              <div id="install-steps" style={{ marginTop: 30 }}>
                <div style={{ display: 'flex', borderBottom: '1px solid var(--line)' }}>
                  {(['windows', 'macos', 'linux'] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveTab(tab)}
                      className="wp-docs-tabbtn"
                      style={{
                        padding: '10px 16px',
                        fontSize: 13.5,
                        fontWeight: 500,
                        border: 0,
                        borderBottom: `2px solid ${activeTab === tab ? 'var(--accent)' : 'transparent'}`,
                        background: 'transparent',
                        color: activeTab === tab ? 'var(--ink)' : 'var(--ink2)',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      {tab === 'windows' ? 'Windows' : tab === 'macos' ? 'macOS' : 'Linux'}
                    </button>
                  ))}
                </div>

                <div style={{ marginTop: 20, display: 'grid', gap: 14 }}>
                  {activeTab === 'windows' && (
                    <>
                      <p style={bodyStyle}>1. Download and run <InlineCode>whiparc-setup-windows-amd64.exe</InlineCode> using the link above.</p>
                      <p style={bodyStyle}>2. Click through the installer. It installs to your user profile (no admin rights needed), adds itself to your <strong style={{ color: 'var(--ink)' }}>User PATH</strong>, and sets up the uninstaller — nothing to configure by hand.</p>
                      <p style={bodyStyle}>3. Windows SmartScreen may flag the installer since it isn&apos;t code-signed yet — choose <strong style={{ color: 'var(--ink)' }}>More info → Run anyway</strong>.</p>
                      <p style={bodyStyle}>4. Open a new terminal and verify:</p>
                      <CodeBlock code="whiparc --version" />
                      <details className="wp-blueprint wp-docs-details" style={cardStyle}>
                        <BlueprintCorners />
                        <summary style={{ cursor: 'pointer', fontSize: 13.5, fontWeight: 500, color: 'var(--ink2)' }}>Manual install (advanced)</summary>
                        <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
                          <p style={bodyStyle}>
                            Prefer to place the binary yourself? Download <InlineCode>whiparc-windows-amd64.exe</InlineCode>, move it into a folder such as <InlineCode>C:\tools\whiparc</InlineCode> and rename it to <InlineCode>whiparc.exe</InlineCode>, then add that folder to your PATH:
                          </p>
                          <CodeBlock code={'[System.Environment]::SetEnvironmentVariable("PATH", $env:Path + ";C:\\tools\\whiparc", "User")'} />
                        </div>
                      </details>
                    </>
                  )}

                  {activeTab === 'macos' && (
                    <>
                      <p style={bodyStyle}>1. Download and open <InlineCode>whiparc-macos.pkg</InlineCode> using the link above — one universal installer covers both Apple Silicon and Intel.</p>
                      <p style={bodyStyle}>2. Follow the installer. It places <InlineCode>whiparc</InlineCode> in <InlineCode>/usr/local/bin</InlineCode>, which is already on macOS&apos;s default PATH — no shell profile edits needed.</p>
                      <p style={bodyStyle}>3. Gatekeeper may warn that the package is from an unidentified developer since it isn&apos;t notarized yet — right-click the <InlineCode>.pkg</InlineCode> and choose <strong style={{ color: 'var(--ink)' }}>Open</strong> to bypass it once.</p>
                      <p style={bodyStyle}>4. Open a new terminal and verify:</p>
                      <CodeBlock code="whiparc --version" />
                      <details className="wp-blueprint wp-docs-details" style={cardStyle}>
                        <BlueprintCorners />
                        <summary style={{ cursor: 'pointer', fontSize: 13.5, fontWeight: 500, color: 'var(--ink2)' }}>Manual install (advanced)</summary>
                        <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
                          <p style={bodyStyle}>Prefer to place the binary yourself? Download the binary matching your architecture (Apple Silicon or Intel), then:</p>
                          <CodeBlock code="sudo mv ~/Downloads/whiparc-darwin-arm64 /usr/local/bin/whiparc" />
                          <CodeBlock code="chmod +x /usr/local/bin/whiparc" />
                        </div>
                      </details>
                    </>
                  )}

                  {activeTab === 'linux' && (
                    <>
                      <p style={bodyStyle}>
                        1. Debian/Ubuntu or Fedora/RHEL — download the matching <InlineCode>.deb</InlineCode>/<InlineCode>.rpm</InlineCode> from the{' '}
                        <a href="https://github.com/whiparc/whiparc/releases" target="_blank" rel="noreferrer" className="wp-docs-toclink" style={{ color: 'var(--accent-ink)' }}>
                          latest GitHub Release
                        </a>{' '}
                        and install it with your package manager (<InlineCode>sudo dpkg -i whiparc_*.deb</InlineCode> or <InlineCode>sudo rpm -i whiparc-*.rpm</InlineCode>).
                      </p>
                      <p style={bodyStyle}>2. Any other distro — run the install script (download it above first, or pipe it directly). It detects your architecture, installs to <InlineCode>~/.local/bin</InlineCode>, and adds that to your PATH only if it isn&apos;t already there:</p>
                      <CodeBlock code={`curl -fsSL ${activeLinks.linuxInstallScript} | sh`} />
                      <p style={bodyStyle}>3. Open a new terminal (or <InlineCode>source</InlineCode> your shell rc) and verify:</p>
                      <CodeBlock code="whiparc --version" />
                      <details className="wp-blueprint wp-docs-details" style={cardStyle}>
                        <BlueprintCorners />
                        <summary style={{ cursor: 'pointer', fontSize: 13.5, fontWeight: 500, color: 'var(--ink2)' }}>Manual install (advanced)</summary>
                        <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
                          <p style={bodyStyle}>Prefer to place the binary yourself? Download <InlineCode>whiparc-linux-amd64</InlineCode>, then:</p>
                          <CodeBlock code="sudo mv ~/Downloads/whiparc-linux-amd64 /usr/local/bin/whiparc" />
                          <CodeBlock code="chmod +x /usr/local/bin/whiparc" />
                        </div>
                      </details>
                    </>
                  )}
                </div>
              </div>

              <div style={{ marginTop: 24 }}>
                <button type="button" onClick={() => setActiveSection('sandbox-intro')} className="wp-docs-submit" style={{ height: 38, padding: '0 20px', display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontFamily: 'var(--font-display)', fontWeight: 600, background: 'var(--accent)', color: 'var(--on-accent)', border: 0, cursor: 'pointer' }}>
                  Next: Set Up Your Local Sandbox
                  <Icon icon="lucide:arrow-right" width={14} />
                </button>
              </div>
            </section>
          )}

          {activeSection === 'sandbox-intro' && (
            <section>
              <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,34px)', letterSpacing: '-.01em', color: 'var(--ink)' }}>Why a Local Sandbox?</h1>
              <p style={{ margin: '14px 0 0', fontSize: 15.5, lineHeight: 1.65, color: 'var(--ink2)', maxWidth: '38em' }}>
                Every deploy that targets the built-in sandbox (LocalStack + simulated SSH targets, no real cloud account needed) has to run <em>somewhere</em>. Historically that meant Whiparc&rsquo;s own servers — free for you, but a real, unbounded compute cost on our side for every user who never upgrades. The <strong style={{ color: 'var(--ink)' }}>Sandbox Agent</strong> moves that compute onto your own machine instead: a small <InlineCode>whiparc</InlineCode> process opens an outbound connection to Whiparc, and your deploys run against Docker containers on your own laptop or workstation, driven the exact same way from the visual canvas.
              </p>

              <div id="sandbox-intro-changes" className="wp-blueprint" style={{ ...cardStyle, marginTop: 26 }}>
                <BlueprintCorners />
                <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, color: 'var(--ink)' }}>What actually changes</h3>
                <ul style={{ margin: '14px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 12 }}>
                  <li style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <Icon icon="lucide:check-circle-2" width={16} style={{ color: 'var(--accent-ink)', marginTop: 2, flexShrink: 0 }} />
                    <span style={{ fontSize: 13.5, color: 'var(--ink2)' }}>Deploys, destroys, and log streaming from the canvas work exactly as before — the Runner still does everything it always did, it just reaches your machine through a tunnel instead of a container on the same host.</span>
                  </li>
                  <li style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <Icon icon="lucide:check-circle-2" width={16} style={{ color: 'var(--accent-ink)', marginTop: 2, flexShrink: 0 }} />
                    <span style={{ fontSize: 13.5, color: 'var(--ink2)' }}>Your machine needs Docker running while you&rsquo;re deploying (see the Docker Desktop note below) — nothing else changes about how you use the canvas.</span>
                  </li>
                  <li style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <Icon icon="lucide:alert-triangle" width={16} style={{ color: 'var(--amber)', marginTop: 2, flexShrink: 0 }} />
                    <span style={{ fontSize: 13.5, color: 'var(--ink2)' }}>On the Free plan, sandbox deploys may require a paired Agent — the workspace header shows a notice before this ever blocks you, with time to set one up. Pro plans keep the hosted sandbox with no local Docker requirement at all.</span>
                  </li>
                </ul>
              </div>

              <div id="sandbox-intro-docker" className="wp-blueprint" style={{ ...cardStyle, marginTop: 16 }}>
                <BlueprintCorners />
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, color: 'var(--ink)' }}>
                  <Icon icon="logos:docker-icon" width={18} /> Docker Desktop licensing
                </h3>
                <p style={{ margin: '10px 0 0', fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink2)' }}>
                  Docker Desktop is free for individuals, small businesses, education, and open-source use — but requires a paid subscription at larger companies. If that applies to you, <strong style={{ color: 'var(--ink)' }}>Podman</strong>, <strong style={{ color: 'var(--ink)' }}>Colima</strong>, and <strong style={{ color: 'var(--ink)' }}>Rancher Desktop</strong> are all compatible alternatives; the sandbox only needs a working Docker-compatible socket, not Docker Desktop specifically.
                </p>
                <p style={{ margin: '8px 0 0', fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink2)' }}>
                  <strong style={{ color: 'var(--ink)' }}>Windows</strong> users: Docker Desktop with the WSL2 backend is the supported path. Most &ldquo;it just doesn&rsquo;t work&rdquo; reports on Windows trace back to WSL2 not being enabled, not Whiparc itself.
                </p>
              </div>

              <div style={{ marginTop: 24 }}>
                <button type="button" onClick={() => setActiveSection('sandbox-setup')} className="wp-docs-submit" style={{ height: 38, padding: '0 20px', display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontFamily: 'var(--font-display)', fontWeight: 600, background: 'var(--accent)', color: 'var(--on-accent)', border: 0, cursor: 'pointer' }}>
                  Continue to Setup & Pairing
                  <Icon icon="lucide:arrow-right" width={14} />
                </button>
              </div>
            </section>
          )}

          {activeSection === 'sandbox-setup' && (
            <section>
              <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,34px)', letterSpacing: '-.01em', color: 'var(--ink)' }}>Setup & Pairing</h1>
              <p style={{ margin: '14px 0 0', ...bodyStyle }}>One command brings up the local sandbox containers and pairs an Agent to a project — no repository checkout needed, just the CLI binary from the Installation Guide.</p>

              <h3 id="sandbox-setup-login" style={h2Style}>1. Log in</h3>
              <CodeBlock code="whiparc login" />

              <h3 id="sandbox-setup-enable" style={h2Style}>2. Enable the Sandbox Agent</h3>
              <p style={bodyStyle}>This is an opt-in beta feature — enable it once per machine:</p>
              <div style={{ marginTop: 10 }}>
                <CodeBlock code="whiparc config set sandbox-agent-beta true" />
              </div>

              <h3 id="sandbox-setup-up" style={h2Style}>3. Bring up the sandbox</h3>
              <p style={bodyStyle}>
                Find your project ID from its URL in the dashboard (<InlineCode>/workspace/&lt;project-id&gt;</InlineCode>), then run:
              </p>
              <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
                <CodeBlock code="whiparc sandbox up --project <project-id>" />
                <p style={bodyStyle}>
                  This generates a fresh SSH keypair for this installation, builds and starts the local sandbox containers via Docker, registers the key with Whiparc, and pairs an Agent — all in one step, no browser approval needed. You&rsquo;ll see output like:
                </p>
                <CodeBlock
                  code={`Generating per-installation SSH keypair for agent-a1b2c3d4...
Building and starting local sandbox containers (docker compose)...
Registering agent key with Whiparc...
Registered agent agent-a1b2c3d4 (key fingerprint: SHA256:...)
Pairing with the Agent Gateway...
Starting the local Agent process...
Waiting for the Agent to connect...
Agent agent-a1b2c3d4 is now ACTIVE. Sandbox is ready.`}
                />
              </div>

              <h3 id="sandbox-setup-deploy" style={h2Style}>4. Deploy from the canvas</h3>
              <p style={bodyStyle}>Open the project&rsquo;s workspace — a green &ldquo;Agent Connected&rdquo; badge appears in the header. Deploy as usual; sandbox-targeted nodes now run through your machine instead of a hosted container.</p>

              <div id="sandbox-setup-nosetup" className="wp-blueprint" style={{ ...cardStyle, marginTop: 20 }}>
                <BlueprintCorners />
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, color: 'var(--ink)' }}>
                  <Icon icon="lucide:check-circle" width={16} style={{ color: 'var(--accent-ink)' }} /> No setup needed for whiparc.com
                </h3>
                <p style={{ margin: '8px 0 0', fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink2)' }}>
                  The official CLI already points at Whiparc&apos;s hosted API and Agent Gateway by default — <InlineCode>whiparc login</InlineCode> and <InlineCode>whiparc sandbox up</InlineCode> above work as-is, nothing to configure first.
                </p>
              </div>

              <div id="sandbox-setup-selfhost" className="wp-blueprint" style={{ ...cardStyle, marginTop: 16 }}>
                <BlueprintCorners />
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, color: 'var(--ink)' }}>
                  <Icon icon="lucide:info" width={16} style={{ color: 'var(--accent-ink)' }} /> Self-hosting or local development
                </h3>
                <p style={{ margin: '8px 0 0', fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink2)' }}>
                  Only needed if you&apos;re running your own Whiparc instance, or developing against a local <InlineCode>apps/api</InlineCode>/Agent Gateway from source — point the CLI at it instead:
                </p>
                <div style={{ marginTop: 10 }}>
                  <CodeBlock code={`whiparc config set api-url https://api.<your-domain>
whiparc config set gateway-url https://gateway.<your-domain>`} />
                </div>
                <p style={{ margin: '10px 0 0', fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink2)' }}>
                  Each setting persists to <InlineCode>~/.whiparc/config.json</InlineCode> for every future command. A one-off override without changing the saved config also works: <InlineCode>whiparc --api-url http://localhost:8080 login</InlineCode>.
                </p>
              </div>

              <div style={{ marginTop: 24 }}>
                <button type="button" onClick={() => setActiveSection('sandbox-commands')} className="wp-docs-submit" style={{ height: 38, padding: '0 20px', display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontFamily: 'var(--font-display)', fontWeight: 600, background: 'var(--accent)', color: 'var(--on-accent)', border: 0, cursor: 'pointer' }}>
                  See the Full Command Reference
                  <Icon icon="lucide:arrow-right" width={14} />
                </button>
              </div>
            </section>
          )}

          {activeSection === 'sandbox-commands' && (
            <section>
              <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,34px)', letterSpacing: '-.01em', color: 'var(--ink)' }}>Sandbox Command Reference</h1>
              <p style={{ margin: '14px 0 0', ...bodyStyle }}>
                The full <InlineCode>whiparc sandbox</InlineCode> subcommand group, once paired via the Setup & Pairing steps above.
              </p>

              <h3 id="sandbox-cmd-status" style={h2Style}>Check connection status</h3>
              <p style={bodyStyle}>
                Shows the paired Agent&rsquo;s ID, connection status (<InlineCode>PENDING</InlineCode> / <InlineCode>ACTIVE</InlineCode> / <InlineCode>DISCONNECTED</InlineCode>), and last-seen time — the first thing to check when a deploy isn&rsquo;t reaching your sandbox:
              </p>
              <div style={{ marginTop: 10 }}>
                <CodeBlock code="whiparc sandbox status" />
              </div>

              <h3 id="sandbox-cmd-pause" style={h2Style}>Pause the sandbox</h3>
              <p style={bodyStyle}>
                Stops the local sandbox containers and the Agent process, but keeps your pairing — running <InlineCode>sandbox up</InlineCode> again later reconnects the <em>same</em> agent instead of registering a new one. Downloaded container images stay cached too, so the next <InlineCode>up</InlineCode> is fast:
              </p>
              <div style={{ marginTop: 10 }}>
                <CodeBlock code="whiparc sandbox down" />
              </div>

              <h3 id="sandbox-cmd-retire" style={h2Style}>Retire an agent for good</h3>
              <p style={bodyStyle}>
                Add <InlineCode>--revoke</InlineCode> to also revoke the agent server-side and clear its local pairing state — use this when you&rsquo;re done with a machine for good, not just stepping away. A future <InlineCode>sandbox up</InlineCode> will pair a brand-new agent instead of trying to reconnect this one:
              </p>
              <div style={{ marginTop: 10 }}>
                <CodeBlock code="whiparc sandbox down --revoke" />
              </div>

              <h3 id="sandbox-cmd-service" style={h2Style}>Run the Agent as a background service</h3>
              <p style={bodyStyle}>
                By default the Agent process from <InlineCode>sandbox up</InlineCode> runs only as long as your session does. Install it as a persistent OS service (a systemd user unit on Linux, a launchd agent on macOS, or a Windows Service) so it survives reboots without needing to re-run <InlineCode>sandbox up</InlineCode>:
              </p>
              <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
                <CodeBlock code="whiparc sandbox agent install" />
                <p style={bodyStyle}>
                  Windows requires an elevated (Administrator) shell to install/uninstall the service; Linux and macOS don&rsquo;t. Re-running <InlineCode>install</InlineCode> replaces any prior registration in place — safe to re-run after re-pairing to a different project.
                </p>
                <CodeBlock code="whiparc sandbox agent uninstall" />
              </div>

              <div id="sandbox-cmd-manage" className="wp-blueprint" style={{ ...cardStyle, marginTop: 20 }}>
                <BlueprintCorners />
                <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, color: 'var(--ink)' }}>Managing paired Agents</h3>
                <p style={{ margin: '10px 0 0', fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink2)' }}>
                  A project&rsquo;s <strong style={{ color: 'var(--ink)' }}>Settings → Sandbox Agents</strong> tab lists every Agent ever paired to it and lets a project Editor or Admin revoke one — the paired machine is disconnected immediately and its pairing token is invalidated. Useful when replacing a machine or removing access from someone who no longer needs it. A developer can also revoke their own agent directly from the machine it&rsquo;s paired to with <InlineCode>whiparc sandbox down --revoke</InlineCode>, without needing project-owner access.
                </p>
              </div>
            </section>
          )}

          {activeSection === 'sandbox-troubleshooting' && (
            <section>
              <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,34px)', letterSpacing: '-.01em', color: 'var(--ink)' }}>Troubleshooting</h1>

              <h3 id="ts-beta" style={h2Style}>&ldquo;Sandbox Agent is an opt-in beta&rdquo;</h3>
              <p style={bodyStyle}>Every <InlineCode>sandbox</InlineCode> subcommand needs the beta flag enabled once per machine:</p>
              <div style={{ marginTop: 10 }}>
                <CodeBlock code="whiparc config set sandbox-agent-beta true" />
              </div>

              <h3 id="ts-pending" style={h2Style}>Agent status stuck on PENDING</h3>
              <p style={bodyStyle}>
                Pairing was registered but the Agent process hasn&rsquo;t connected yet — usually a Docker or network issue on your machine. Check <InlineCode>docker ps</InlineCode> for the sandbox containers and confirm your machine can reach your configured Gateway URL (defaults to Whiparc&apos;s hosted Gateway; see <InlineCode>whiparc config set gateway-url</InlineCode> above if you&apos;ve pointed it elsewhere).
              </p>

              <h3 id="ts-disconnected" style={h2Style}>Agent shows DISCONNECTED, deploys are rejected</h3>
              <p style={bodyStyle}>
                A connection that was working can drop from sleep, WiFi changes, or a VPN reconnecting — this is normal for a machine-hosted tunnel, not a sign something is broken. Deploys are rejected outright while disconnected rather than hanging against a dead connection. Reconnection is automatic (with backoff); re-run <InlineCode>whiparc sandbox status</InlineCode> after a minute, or <InlineCode>whiparc sandbox up</InlineCode> again if it doesn&rsquo;t recover.
              </p>

              <h3 id="ts-not-connected" style={h2Style}>&ldquo;This project&rsquo;s local Sandbox Agent is not connected&rdquo;</h3>
              <p style={bodyStyle}>
                A deploy or destroy pre-flight check rejecting a request because the paired Agent is <InlineCode>PENDING</InlineCode> or <InlineCode>DISCONNECTED</InlineCode> — this is deliberate, so a run never silently falls back to a different target than the one you intended. Reconnect the Agent, or revoke it under Project Settings → Sandbox Agents to deploy without it instead (falls back to the hosted sandbox, where available for your plan).
              </p>

              <h3 id="ts-migration" style={h2Style}>&ldquo;Free-tier sandbox deploys now run through your own machine…&rdquo;</h3>
              <p style={bodyStyle}>Your plan and signup date put you past the local-sandbox migration window. Follow Setup & Pairing above to pair an Agent, or upgrade to Pro to keep using the hosted sandbox with no local Docker requirement.</p>

              <h3 id="ts-docker" style={h2Style}>Docker daemon not found</h3>
              <p style={bodyStyle}>
                <InlineCode>sandbox up</InlineCode> needs a running Docker-compatible daemon. Confirm Docker Desktop (or Podman/Colima/Rancher Desktop) is actually running before retrying — see the Docker Desktop licensing note on the &ldquo;Why a Local Sandbox?&rdquo; page for alternatives if Docker Desktop isn&apos;t an option at your company.
              </p>
            </section>
          )}

          {activeSection === 'auth' && (
            <section>
              <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,34px)', letterSpacing: '-.01em', color: 'var(--ink)' }}>Authentication</h1>
              <p style={{ margin: '14px 0 0', ...bodyStyle }}>To link commands to your user accounts and target workspace permission boundaries, authenticate your CLI instance.</p>

              <h3 id="auth-login" style={h2Style}>Login</h3>
              <p style={bodyStyle}>Run the login sub-command. The program will prompt for your account email and password securely, then query and write your session token:</p>
              <div style={{ marginTop: 10 }}>
                <CodeBlock code="whiparc login" />
              </div>

              <h3 id="auth-logout" style={h2Style}>Logout</h3>
              <p style={bodyStyle}>To clear your locally cached credentials and end the session:</p>
              <div style={{ marginTop: 10 }}>
                <CodeBlock code="whiparc logout" />
              </div>
            </section>
          )}

          {activeSection === 'projects' && (
            <section>
              <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,34px)', letterSpacing: '-.01em', color: 'var(--ink)' }}>Workspace Projects CRUD</h1>
              <p style={{ margin: '14px 0 0', ...bodyStyle }}>Query, initialize, or delete visual workspace canvas projects using the <InlineCode>projects</InlineCode> subcommand.</p>

              <h3 id="projects-list" style={h2Style}>List Projects</h3>
              <div style={{ marginTop: 10 }}>
                <CodeBlock code="whiparc projects list" />
              </div>

              <h3 id="projects-create" style={h2Style}>Create a Project</h3>
              <p style={bodyStyle}>Initialize a new project workspace by name:</p>
              <div style={{ marginTop: 10 }}>
                <CodeBlock code='whiparc projects create --name "My VPC Stack" --visibility PRIVATE' />
              </div>

              <h3 id="projects-delete" style={h2Style}>Delete a Project</h3>
              <div style={{ marginTop: 10 }}>
                <CodeBlock code='whiparc projects delete --id "my-vpc-stack-id" --force' />
              </div>
            </section>
          )}

          {activeSection === 'import' && (
            <section>
              <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,34px)', letterSpacing: '-.01em', color: 'var(--ink)' }}>Importing IaC Code</h1>
              <p style={{ margin: '14px 0 0', ...bodyStyle }}>You can import existing code configurations directly into your visual workspace. The engine automatically maps resource structures into nodes/edges and auto-arranges layout coordinates.</p>

              <h3 id="import-file" style={h2Style}>Import a Single File</h3>
              <p style={bodyStyle}>Upload and parse a single Terraform or Kubernetes configuration:</p>
              <div style={{ marginTop: 10 }}>
                <CodeBlock code='whiparc import --project "VPC-Stack" --file "./terraform/main.tf"' />
              </div>

              <h3 id="import-dir" style={h2Style}>Import a Directory</h3>
              <p style={bodyStyle}>Recursively scan and import all configurations from a target directory:</p>
              <div style={{ marginTop: 10 }}>
                <CodeBlock code='whiparc import --project "VPC-Stack" --dir "./deployments/"' />
              </div>
            </section>
          )}

          {activeSection === 'deploy' && (
            <section>
              <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,34px)', letterSpacing: '-.01em', color: 'var(--ink)' }}>Deploy & Logs Streaming</h1>
              <p style={{ margin: '14px 0 0', ...bodyStyle }}>Deploy pipelines from the visual canvas and stream execution logs directly to your shell.</p>

              <h3 id="deploy-run" style={h2Style}>Execute Deployment Pipeline</h3>
              <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
                <CodeBlock code='whiparc deploy --project "VPC-Stack"' />
                <p style={bodyStyle}>This command connects to the deployment tracker socket, streaming all progress logs sequentially and printing them in real-time.</p>
              </div>

              <h3 id="deploy-autodestroy" style={h2Style}>Deploy with Auto-Destroy</h3>
              <p style={bodyStyle}>To spin up testing systems and tear them down immediately upon execution completion:</p>
              <div style={{ marginTop: 10 }}>
                <CodeBlock code='whiparc deploy --project "VPC-Stack" --auto-destroy' />
              </div>
            </section>
          )}
        </main>

        {/* RIGHT TOC */}
        <nav className="wp-docs-toc">
          {toc.length > 0 && (
            <>
              <p style={{ margin: '0 0 10px', fontFamily: 'var(--font-mono-marketing)', fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink3)' }}>On this page</p>
              {toc.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    scrollToId(item.id);
                  }}
                  className="wp-docs-toclink"
                  style={{ display: 'block', marginBottom: 8, fontSize: 12.5, color: 'var(--ink2)' }}
                >
                  {item.label}
                </a>
              ))}
            </>
          )}
        </nav>
      </div>

      {/* FOOTER */}
      <footer style={{ borderTop: '1px solid var(--line)', padding: '24px clamp(16px,3vw,28px)' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <p style={{ margin: 0, fontFamily: 'var(--font-mono-marketing)', fontSize: 11, color: 'var(--ink3)' }}>© 2026 Whiparc. All rights reserved.</p>
          <div style={{ display: 'flex', gap: 18, fontFamily: 'var(--font-mono-marketing)', fontSize: 11, color: 'var(--ink3)' }}>
            <Link href="/" className="wp-docs-toclink" style={{ color: 'var(--ink3)' }}>
              Home
            </Link>
            <span style={{ cursor: 'not-allowed' }}>Terms</span>
            <span style={{ cursor: 'not-allowed' }}>Privacy</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
