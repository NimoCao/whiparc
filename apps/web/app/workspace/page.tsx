'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '../store/useAuthStore';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  ReactFlowProvider,
  useReactFlow,
  Connection,
  Edge,
  ConnectionLineType,
  Node,
  NodeChange,
  EdgeChange
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Icon } from '@iconify/react';
import { clsx } from 'clsx';

import useCanvasStore from '../store/useCanvasStore';
import ReactFlowCanvasNode from '../components/ReactFlowCanvasNode';
import BlueprintEdge from '../components/canvas/BlueprintEdge';
import EdgeInspector from '../components/canvas/EdgeInspector';
import CustomNodeModal from '../components/CustomNodeModal';
import { ProjectSettingsModal } from '../components/ProjectSettingsModal';
import { InputWithVariablePicker } from '../components/VariablePicker';
import EmailVerificationBanner from '../components/EmailVerificationBanner';
import { generateAnsibleYAML } from '../lib/exportYaml';
import { downloadZipBundle, downloadTerraformZip, generateBundleFiles, generateTerraformFiles } from '../lib/bundleGenerator';
import { DEFAULT_INSTANCE_PARAMS, DEFAULT_SG_PARAMS } from '../lib/terraformDefaults';
import type { Project } from '../lib/types';
import { spaceGroteskFont, barlowFont, jetBrainsMonoFont } from '../fonts';
import { THEME_PALETTES, type Theme } from '../components/ui/theme-palette';
import { LEGACY_TOKEN_SCOPE_STYLE } from '../components/ui/legacy-token-scope';
import { WorkspaceHeaderV2, type WorkspaceView } from './WorkspaceHeaderV2';
import { LibraryPanelV2 } from './LibraryPanelV2';
import { ConsoleBar } from './ConsoleBar';
import { ProjectVariablesView } from './ProjectVariablesView';
import '../components/ui/blueprint.css';
import './workspace.css';

// Define layout components inside the workspace directory for encapsulation

// --- TYPES & INTERFACES ---

interface Tag {
  key: string;
  value: string;
}

interface LibraryNode {
  id: string;
  tech: 'Terraform' | 'Ansible' | 'Kubernetes' | 'Source' | 'Target';
  icon: string;
  title: string;
  description: string;
  category: string;
  isCustom?: boolean;
  rawCode?: string;
  codeType?: 'tf' | 'yml' | 'yaml';
  parameters?: Record<string, unknown>;
  outputs?: string[];
}

// Cloud/SSH credential summary as returned by GET /api/projects/:id/credentials
// (mirrors CredentialItem in components/CredentialManagerModal.tsx).
interface Credential {
  id: string;
  project_id: string;
  provider: string;
  name: string;
  key_fingerprint: string;
  created_at: string;
}

// --- HELPER SUB-COMPONENTS ---

// Header, NodeCard, and LibraryPanel used to live here — replaced by
// WorkspaceHeaderV2.tsx and LibraryPanelV2.tsx (the new blueprint-styled
// chrome). The floating select/pan/link/reset tool-switcher that used to
// live here (CanvasControls) is gone too — the canvas now behaves like a
// standard drawing-canvas tool (Excalidraw-style): drag empty space to
// pan, scroll to zoom, drag a node to move it, all always-on rather than
// behind a mode switch. Its "Reset View" icon was actually a destructive
// clear-the-whole-canvas action; that's now "Clear canvas" in the header's
// overflow ("...") menu, with a confirmation dialog it never had before.

// YAML Syntax Highlighting Function
function highlightYAMLCode(code: string): React.ReactNode[] {
  const lines = code.split('\n');
  
  return lines.map((line, lineIdx) => {
    const parts: React.ReactNode[] = [];
    let remaining = line;
    let charIdx = 0;

    while (remaining.length > 0) {
      // Comments
      if (remaining.startsWith('#') || remaining.startsWith('---')) {
        parts.push(
          <span key={`${lineIdx}-${charIdx}`} className="text-emerald-500">
            {remaining}
          </span>
        );
        break;
      }

      // Dashes at line start
      if (remaining.match(/^(\s*)- /)) {
        const dashMatch = remaining.match(/^(\s*)- /);
        if (dashMatch) {
          const indent = dashMatch[1];
          parts.push(
            <span key={`${lineIdx}-${charIdx}`} className="text-slate-400">
              {indent}
              <span className="text-blue-400">-</span>
              {' '}
            </span>
          );
          charIdx += dashMatch[0].length;
          remaining = remaining.slice(dashMatch[0].length);
          continue;
        }
      }

      // YAML keys
      if (remaining.match(/^(\s*)[a-zA-Z_][a-zA-Z0-9_-]*\s*:/)) {
        const keyMatch = remaining.match(/^(\s*)([a-zA-Z_][a-zA-Z0-9_-]*)\s*:/);
        if (keyMatch) {
          const indent = keyMatch[1];
          const key = keyMatch[2];
          parts.push(
            <span key={`${lineIdx}-${charIdx}`}>
              <span className="text-slate-400">{indent}</span>
              <span className="text-blue-300">{key}</span>
              <span className="text-slate-400">:</span>
            </span>
          );
          charIdx += keyMatch[0].length;
          remaining = remaining.slice(keyMatch[0].length);
          continue;
        }
      }

      // String values (quoted or variables in curly braces)
      if (remaining.match(/^(\s*)(["'])(.*?)\2/)) {
        const stringMatch = remaining.match(/^(\s*)(["'])(.*?)\2/);
        if (stringMatch) {
          const indent = stringMatch[1];
          const quote = stringMatch[2];
          const value = stringMatch[3];
          parts.push(
            <span key={`${lineIdx}-${charIdx}`}>
              <span className="text-slate-400">{indent}</span>
              <span className="text-orange-400">
                {quote}
                {value}
                {quote}
              </span>
            </span>
          );
          charIdx += stringMatch[0].length;
          remaining = remaining.slice(stringMatch[0].length);
          continue;
        }
      }

      // Booleans
      if (remaining.match(/^(\s*)(true|false|yes|no|on|off)(?:\s|$|#)/i)) {
        const boolMatch = remaining.match(/^(\s*)(true|false|yes|no|on|off)/i);
        if (boolMatch) {
          const indent = boolMatch[1];
          const bool = boolMatch[2];
          parts.push(
            <span key={`${lineIdx}-${charIdx}`}>
              <span className="text-slate-400">{indent}</span>
              <span className="text-purple-400">{bool}</span>
            </span>
          );
          charIdx += boolMatch[0].length;
          remaining = remaining.slice(boolMatch[0].length);
          continue;
        }
      }

      // Numbers
      if (remaining.match(/^(\s*)(\d+(\.\d+)?)/)) {
        const numMatch = remaining.match(/^(\s*)(\d+(\.\d+)?)/);
        if (numMatch) {
          const indent = numMatch[1];
          const num = numMatch[2];
          parts.push(
            <span key={`${lineIdx}-${charIdx}`}>
              <span className="text-slate-400">{indent}</span>
              <span className="text-green-400">{num}</span>
            </span>
          );
          charIdx += numMatch[0].length;
          remaining = remaining.slice(numMatch[0].length);
          continue;
        }
      }

      // Plain text
      const textMatch = remaining.match(/^[^:\n#]+/);
      if (textMatch) {
        parts.push(
          <span key={`${lineIdx}-${charIdx}`} className="text-slate-300">
            {textMatch[0]}
          </span>
        );
        charIdx += textMatch[0].length;
        remaining = remaining.slice(textMatch[0].length);
        continue;
      }

      // Fallback
      parts.push(
        <span key={`${lineIdx}-${charIdx}`} className="text-slate-300">
          {remaining[0]}
        </span>
      );
      charIdx += 1;
      remaining = remaining.slice(1);
    }

    return (
      <div key={lineIdx} className="min-h-[1.25rem]">
        {parts}
      </div>
    );
  });
}

// --- LIVE CODE PREVIEW ---

type FileLanguage = 'hcl' | 'yaml' | 'ini' | 'text';

interface PreviewFile {
  name: string;
  content: string;
  language: FileLanguage;
}

function highlightCode(content: string, language: FileLanguage): React.ReactNode[] {
  const lines = content.split('\n');
  return lines.map((line, idx) => {
    let rendered: React.ReactNode = line;
    if (language === 'yaml' || language === 'ini') {
      rendered = highlightYAMLCode(line).length > 0 ? highlightYAMLCode(line) : line;
    } else {
      if (line.trim().startsWith('#') || line.trim().startsWith('//')) {
        rendered = <span className="text-emerald-500">{line}</span>;
      } else {
        const parts = line.split(/("[^"]*")/g);
        rendered = parts.map((part, pIdx) => {
          if (part.startsWith('"') && part.endsWith('"')) {
            return <span key={pIdx} className="text-orange-400">{part}</span>;
          }
          const keywords = ['resource', 'provider', 'terraform', 'variable', 'output', 'data', 'ingress', 'egress', 'tags', 'backend'];
          const kwRe = new RegExp(`(${keywords.join('|')})`, 'g');
          if (kwRe.test(part)) {
            const sub = part.split(new RegExp(`(${keywords.join('|')})`, 'g'));
            return sub.map((s, sIdx) =>
              keywords.includes(s)
                ? <span key={sIdx} className="text-purple-400">{s}</span>
                : s
            );
          }
          return part;
        });
      }
    }
    return <div key={idx} className="min-h-[1.25rem]">{rendered}</div>;
  });
}

function getNodeFiles(node: Node, allNodes: Node[], allEdges: Edge[]): PreviewFile[] {
  const tech = node.data?.tech as string;

  if (node.id.startsWith('aws_instance.web_server') || node.id.startsWith('aws_security_group')) {
    const { mainTf, variablesTf, outputsTf } = generateTerraformFiles(allNodes, allEdges);
    if (node.id.startsWith('aws_security_group')) {
      return [{ name: 'main.tf', content: mainTf, language: 'hcl' }];
    }
    return [
      { name: 'main.tf', content: mainTf, language: 'hcl' },
      { name: 'variables.tf', content: variablesTf, language: 'hcl' },
      { name: 'outputs.tf', content: outputsTf, language: 'hcl' },
    ];
  }

  if (tech === 'Ansible') {
    const files = generateBundleFiles(allNodes, allEdges);
    const playbook = files.find(f => f.name === 'playbook.yml');
    const hosts = files.find(f => f.name === 'hosts.ini');
    return [
      { name: 'playbook.yml', content: playbook?.content ?? '', language: 'yaml' },
      { name: 'hosts.ini', content: hosts?.content ?? '', language: 'ini' },
    ];
  }

  if (tech === 'Kubernetes') {
    const files = generateBundleFiles(allNodes, allEdges);
    const dep = files.find(f => f.name === 'deployment.yaml');
    return [{ name: 'deployment.yaml', content: dep?.content ?? '', language: 'yaml' }];
  }

  return [{ name: `${node.id}.txt`, content: `# ${node.id}\n# No code preview available for this node type.`, language: 'text' }];
}

// CodeBlock: renders syntax-highlighted code with a copy button
const CodeBlock: React.FC<{ file: PreviewFile }> = ({ file }) => {
  const [copied, setCopied] = useState(false);
  const highlighted = useMemo(() => highlightCode(file.content, file.language), [file.content, file.language]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between mb-2 shrink-0 select-none">
        <span className="text-[10px] font-mono text-muted-foreground">{file.name}</span>
        <button
          onClick={() => { navigator.clipboard.writeText(file.content); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className="text-[10px] text-primary hover:text-primary/90 font-semibold flex items-center gap-1 cursor-pointer"
        >
          <Icon icon={copied ? 'lucide:check' : 'lucide:copy'} className="text-xs" />
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div className="flex-1 bg-background border border-border rounded-lg p-3 overflow-auto font-mono text-[11px] text-muted-foreground leading-relaxed">
        <pre className="whitespace-pre-wrap break-all"><code>{highlighted}</code></pre>
      </div>
    </div>
  );
};

interface LiveCodePreviewProps {
  selectedNode: Node | null;
  nodes: Node[];
  edges: Edge[];
}

const LiveCodePreview: React.FC<LiveCodePreviewProps> = ({ selectedNode, nodes, edges }) => {
  const [activeFile, setActiveFile] = useState(0);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({ Terraform: true, Ansible: true, Kubernetes: true });
  const [overviewFile, setOverviewFile] = useState<PreviewFile | null>(null);

  const files = useMemo(
    () => selectedNode ? getNodeFiles(selectedNode, nodes, edges) : [],
    [selectedNode, nodes, edges]
  );

  // Reset to first tab when node changes
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { setActiveFile(0); setOverviewFile(null); }, [selectedNode?.id]);

  const allFiles = useMemo(() => generateBundleFiles(nodes, edges), [nodes, edges]);

  // --- NODE SELECTED: file tab view ---
  if (selectedNode) {
    if (files.length === 0) {
      return (
        <div className="flex items-center justify-center h-full text-xs text-muted-foreground select-none">
          No code preview for this node type.
        </div>
      );
    }
    return (
      <div className="flex flex-col h-full overflow-hidden">
        {/* File tabs */}
        <div className="flex gap-1 mb-3 flex-wrap shrink-0">
          {files.map((f, i) => (
            <button
              key={f.name}
              onClick={() => setActiveFile(i)}
              className={clsx(
                'px-2.5 py-1 rounded text-[10px] font-mono font-semibold border transition-all cursor-pointer',
                activeFile === i
                  ? 'bg-primary/10 border-primary/40 text-primary'
                  : 'bg-muted border-border text-muted-foreground hover:text-foreground hover:border-border/80'
              )}
            >
              {f.name}
            </button>
          ))}
        </div>
        {/* Active file content */}
        <div className="flex-1 overflow-hidden">
          <CodeBlock file={files[activeFile]} />
        </div>
      </div>
    );
  }

  // --- NO NODE SELECTED: canvas overview ---
  const sections: { label: string; color: string; paths: string[] }[] = [
    { label: 'Terraform', color: 'text-primary', paths: ['terraform/'] },
    { label: 'Ansible', color: 'text-[#8B5CF6]', paths: ['ansible/'] },
    { label: 'Kubernetes', color: 'text-[#0EA5E9]', paths: ['k8s/'] },
  ];

  const hasTech = (paths: string[]) =>
    nodes.some(n => {
      const t = n.data?.tech as string;
      if (paths[0].startsWith('terraform')) return t === 'Terraform';
      if (paths[0].startsWith('ansible')) return t === 'Ansible';
      if (paths[0].startsWith('k8s')) return t === 'Kubernetes';
      return false;
    });

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground select-none">
        Add nodes to the canvas to see the compiled code preview.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {overviewFile ? (
        // Expanded file view within overview
        <div className="flex flex-col h-full overflow-hidden">
          <button
            onClick={() => setOverviewFile(null)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground mb-2 shrink-0 cursor-pointer"
          >
            <Icon icon="lucide:arrow-left" className="text-xs" /> Back to overview
          </button>
          <div className="flex-1 overflow-hidden">
            <CodeBlock file={overviewFile} />
          </div>
        </div>
      ) : (
        // Overview: collapsible technology sections
        <div className="flex-1 overflow-y-auto space-y-3">
          <p className="text-[10px] text-muted-foreground select-none">
            Select a node to view its files, or browse the full compiled output below.
          </p>
          {sections.map(({ label, color, paths }) => {
            if (!hasTech(paths)) return null;
            const sectionFiles = allFiles.filter(f => paths.some(p => f.path.startsWith(p)));
            const isOpen = expandedSections[label] ?? true;
            return (
              <div key={label} className="border border-border rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedSections(s => ({ ...s, [label]: !s[label] }))}
                  className="w-full flex items-center justify-between px-3 py-2 bg-muted/50 hover:bg-muted transition-colors cursor-pointer select-none"
                >
                  <span className={clsx('text-[11px] font-bold uppercase tracking-wider', color)}>{label}</span>
                  <Icon icon={isOpen ? 'lucide:chevron-down' : 'lucide:chevron-right'} className="text-muted-foreground text-xs" />
                </button>
                {isOpen && (
                  <div className="divide-y divide-border/50">
                    {sectionFiles.map(f => (
                      <button
                        key={f.path}
                        onClick={() => setOverviewFile({ name: f.name, content: f.content, language: f.language.toLowerCase() as FileLanguage })}
                        className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/30 transition-colors cursor-pointer group"
                      >
                        <div className="flex items-center gap-2">
                          <Icon icon="lucide:file-code" className="text-muted-foreground text-xs shrink-0" />
                          <span className="text-[11px] font-mono text-foreground">{f.name}</span>
                          <span className="text-[10px] text-muted-foreground">{f.lines} lines</span>
                        </div>
                        <span className="text-[10px] text-primary opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                          view <Icon icon="lucide:chevron-right" className="text-[10px]" />
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// A sub-component to show all canvas components when no node is active
const CanvasSummary: React.FC<{
  nodes: Node[];
  onSelectNode: (id: string) => void;
}> = ({ nodes, onSelectNode }) => {
  const targetNodes = nodes.filter((n) => n.data?.tech === 'Target');
  const tfNodes = nodes.filter((n) => n.data?.tech === 'Terraform');
  const ansNodes = nodes.filter((n) => n.data?.tech === 'Ansible');
  const k8sNodes = nodes.filter((n) => n.data?.tech === 'Kubernetes');

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="border-b border-border/80 pb-2">
        <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Canvas Summary</h4>
        <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
          Select any active block below to edit its configurations.
        </p>
      </div>

      <div className="space-y-4">

        {targetNodes.length > 0 && (
          <div className="space-y-2">
            <h5 className="text-[10px] font-bold text-[#14B8A6] uppercase tracking-wider flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#14B8A6] animate-pulse"></span>
              Target ({targetNodes.length})
            </h5>
            <div className="grid gap-1.5">
              {targetNodes.map((node) => (
                <button
                  key={node.id}
                  onClick={() => onSelectNode(node.id)}
                  className="w-full text-left bg-muted/30 hover:bg-muted/70 border border-border/60 hover:border-[#14B8A6]/40 rounded-lg p-2.5 flex items-center justify-between text-xs text-foreground transition-all duration-200 group cursor-pointer"
                >
                  <span className="font-semibold truncate max-w-[200px] flex items-center gap-2">
                    <Icon icon={node.data.icon as string} className="text-[#14B8A6] text-sm flex-shrink-0" />
                    {node.data.label as string}
                  </span>
                  <Icon icon="lucide:chevron-right" className="text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-all text-xs" />
                </button>
              ))}
            </div>
          </div>
        )}

        {tfNodes.length > 0 && (
          <div className="space-y-2">
            <h5 className="text-[10px] font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse"></span>
              Terraform ({tfNodes.length})
            </h5>
            <div className="grid gap-1.5">
              {tfNodes.map((node) => (
                <button
                  key={node.id}
                  onClick={() => onSelectNode(node.id)}
                  className="w-full text-left bg-muted/30 hover:bg-muted/70 border border-border/60 hover:border-primary/40 rounded-lg p-2.5 flex items-center justify-between text-xs text-foreground transition-all duration-200 group cursor-pointer"
                >
                  <span className="font-semibold truncate max-w-[200px] flex items-center gap-2">
                    <Icon icon={node.data.icon as string} className="text-primary text-sm flex-shrink-0" />
                    {node.id}
                  </span>
                  <Icon icon="lucide:chevron-right" className="text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-all text-xs" />
                </button>
              ))}
            </div>
          </div>
        )}

        {ansNodes.length > 0 && (
          <div className="space-y-2">
            <h5 className="text-[10px] font-bold text-[#8B5CF6] uppercase tracking-wider flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#8B5CF6] animate-pulse"></span>
              Ansible ({ansNodes.length})
            </h5>
            <div className="grid gap-1.5">
              {ansNodes.map((node) => (
                <button
                  key={node.id}
                  onClick={() => onSelectNode(node.id)}
                  className="w-full text-left bg-muted/30 hover:bg-muted/70 border border-border/60 hover:border-[#8B5CF6]/40 rounded-lg p-2.5 flex items-center justify-between text-xs text-foreground transition-all duration-200 group cursor-pointer"
                >
                  <span className="font-semibold truncate max-w-[200px] flex items-center gap-2">
                    <Icon icon={node.data.icon as string} className="text-[#8B5CF6] text-sm flex-shrink-0" />
                    {node.data.label as string}
                  </span>
                  <Icon icon="lucide:chevron-right" className="text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-all text-xs" />
                </button>
              ))}
            </div>
          </div>
        )}

        {k8sNodes.length > 0 && (
          <div className="space-y-2">
            <h5 className="text-[10px] font-bold text-[#0EA5E9] uppercase tracking-wider flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#0EA5E9] animate-pulse"></span>
              Kubernetes ({k8sNodes.length})
            </h5>
            <div className="grid gap-1.5">
              {k8sNodes.map((node) => (
                <button
                  key={node.id}
                  onClick={() => onSelectNode(node.id)}
                  className="w-full text-left bg-muted/30 hover:bg-muted/70 border border-border/60 hover:border-[#0EA5E9]/40 rounded-lg p-2.5 flex items-center justify-between text-xs text-foreground transition-all duration-200 group cursor-pointer"
                >
                  <span className="font-semibold truncate max-w-[200px] flex items-center gap-2">
                    <Icon icon={node.data.icon as string} className="text-[#0EA5E9] text-sm flex-shrink-0" />
                    {node.data.label as string}
                  </span>
                  <Icon icon="lucide:chevron-right" className="text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-all text-xs" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// InspectorPanel Component
interface InspectorPanelProps {
  collapsed: boolean;
  onToggle: () => void;
  selectedNode: Node | null;
  selectedEdge: Edge | null;
  updateNodeData: (nodeId: string, newData: Record<string, unknown>) => void;
  updateEdgeData: (edgeId: string, label: string, animated: boolean, stroke: string, strokeWidth: number) => void;
  deleteEdge: (edgeId: string) => void;
  nodes: Node[];
  setSelectedNodeId: (id: string | null) => void;
  isReadOnly?: boolean;
  onStartEditing?: (nodeId: string) => void;
  onEndEditing?: (nodeId: string) => void;
  availableCredentials?: Credential[];
}

// Union of every field InspectorPanel reads/writes on selectedNode.data.parameters
// across all node "tech" types (Terraform/Ansible/Kubernetes). The underlying data
// is loosely-validated per-node JSON, so every field is optional.
interface InspectorNodeParameters {
  // EC2 / Terraform instance
  instanceName?: string;
  amiId?: string;
  instanceType?: string;
  subnetId?: string;
  securityGroupId?: string;
  rootVolumeSize?: number;
  tags?: Tag[];
  // GCP instance
  gcpInstanceName?: string;
  gcpMachineType?: string;
  gcpImage?: string;
  gcpNetwork?: string;
  gcpDiskSize?: number;
  // Azure instance
  azureVmName?: string;
  azureVmSize?: string;
  azurePublisher?: string;
  azureOffer?: string;
  azureSku?: string;
  azureDiskSize?: number;
  // Security group
  sgName?: string;
  description?: string;
  httpPort?: number;
  httpsPort?: number;
  allowedCidr?: string;
  vpcId?: string;
  sshEnabled?: boolean;
  ingressPorts?: string;
  // S3
  bucketName?: string;
  versioningEnabled?: boolean;
  forceDestroy?: boolean;
  // RDS
  dbName?: string;
  engineVersion?: string;
  instanceClass?: string;
  allocatedStorage?: number;
  username?: string;
  password?: string;
  vpcSecurityGroupIds?: string;
  dbSubnetGroupName?: string;
  // VPC
  vpcName?: string;
  cidrBlock?: string;
  enableDnsHostnames?: boolean;
  // Subnet
  subnetName?: string;
  availabilityZone?: string;
  mapPublicIp?: boolean;
  // Ansible common
  ansibleHost?: string;
  ansibleUser?: string;
  packages?: string;
  state?: string;
  shell?: string;
  createHome?: boolean;
  serviceName?: string;
  enabled?: boolean;
  repoUrl?: string;
  destPath?: string;
  branch?: string;
  credentialId?: string;
  command?: string;
  chdir?: string;
  srcPath?: string;
  owner?: string;
  mode?: string;
  // Kubernetes
  deploymentName?: string;
  replicas?: number;
  containerPort?: number;
  imageName?: string;
  cpuLimit?: string;
  memoryLimit?: string;
  serviceType?: string;
  port?: number;
  targetPort?: number;
  configMapName?: string;
  dataKey?: string;
  dataValue?: string;
  secretName?: string;
  secretKey?: string;
  secretValue?: string;
  ingressName?: string;
  host?: string;
  path?: string;
  servicePort?: number;
  pvcName?: string;
  storageSize?: string;
  storageClass?: string;
}

const InspectorPanel: React.FC<InspectorPanelProps> = ({
  collapsed,
  onToggle,
  selectedNode,
  selectedEdge,
  updateNodeData,
  updateEdgeData,
  deleteEdge,
  nodes,
  setSelectedNodeId,
  isReadOnly = false,
  onStartEditing,
  onEndEditing,
  availableCredentials = [],
}) => {
  const [newTagKey, setNewTagKey] = useState('');
  const [newTagVal, setNewTagVal] = useState('');
  const [showAddTag, setShowAddTag] = useState(false);
  const [activeVmTab, setActiveVmTab] = useState<'aws' | 'gcp' | 'azure'>('aws');

  const p: InspectorNodeParameters = (selectedNode?.data?.parameters as InspectorNodeParameters | undefined) || (selectedNode ? (getDefaultParametersForNode(selectedNode.id) as InspectorNodeParameters) : {});

  const handleParameterChange = (key: string, value: unknown) => {
    if (!selectedNode || isReadOnly) return;
    updateNodeData(selectedNode.id, {
      parameters: { ...p, [key]: value }
    });
  };

  const handleTagAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) return;
    if (newTagKey && newTagVal && selectedNode) {
      updateNodeData(selectedNode.id, {
        parameters: {
          ...p,
          tags: [...(p.tags || []), { key: newTagKey, value: newTagVal }]
        }
      });
      setNewTagKey('');
      setNewTagVal('');
      setShowAddTag(false);
    }
  };

  const handleTagDelete = (index: number) => {
    if (!selectedNode || isReadOnly) return;
    updateNodeData(selectedNode.id, {
      parameters: {
        ...p,
        tags: (p.tags || []).filter((_: Tag, idx: number) => idx !== index)
      }
    });
  };

  // Node variable inputs for Ansible nodes
  const nodeLabel = selectedNode?.data?.label as string || '';
  const portVal = (selectedNode?.data?.port as string) || '';
  const dbUserVal = (selectedNode?.data?.dbUser as string) || '';
  const dbPassVal = (selectedNode?.data?.dbPass as string) || '';
  const environmentVal = (selectedNode?.data?.environment as string) || 'localstack';
  const regionVal = (selectedNode?.data?.region as string) || 'us-east-1';
  const credentialIdVal = (selectedNode?.data?.credentialId as string) || '';
  const sshKeyIdVal = (selectedNode?.data?.sshKeyId as string) || '';
  const projectIDVal = (selectedNode?.data?.projectId as string) || '';
  const gcpZoneVal = (selectedNode?.data?.gcpZone as string) || 'us-central1-a';
  const startCommandVal = (selectedNode?.data?.startCommand as string) || '';
  const appPortVal = (selectedNode?.data?.appPort as string) || '';

  return (
    <aside
      className={clsx(
        "wp-legacy-token-scope bg-card/95 backdrop-blur-md flex flex-col shrink-0 z-20 transition-all duration-300 relative overflow-visible",
        collapsed ? "w-0 border-l-0" : "w-90 border-l border-border"
      )}
      style={LEGACY_TOKEN_SCOPE_STYLE}
    >
      {/* Sliding Window Container */}
      <div className="w-full h-full overflow-hidden">
        {/* Fixed Width Content Panel */}
        <div className="w-90 h-full flex flex-col">
          {/* Inspector Header — plain kicker + title, matching the design's
              "SELECTED NODE / aws_instance.app" treatment. No icon badge:
              the mock doesn't have one, and a colored rounded icon box was
              the clearest holdover from the pre-redesign shadcn styling. */}
          <div className="border-b border-border select-none" style={{ padding: '14px 16px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <p className="uppercase text-muted-foreground" style={{ margin: 0, fontSize: 9.5 }}>
                {selectedEdge ? 'Selected connection' : selectedNode ? 'Selected node' : 'Global configuration'}
              </p>
              <p className="text-foreground truncate" style={{ margin: '6px 0 0', maxWidth: 220, fontFamily: 'var(--font-display, inherit)', fontWeight: 600, fontSize: 17 }}>
                {selectedNode?.id || (selectedEdge ? (typeof selectedEdge.label === 'string' && selectedEdge.label) || 'Connection' : 'No selection')}
              </p>
            </div>
            <button onClick={onToggle} className="text-muted-foreground hover:text-foreground transition-all cursor-pointer" style={{ background: 'none', border: 0, padding: 4, flexShrink: 0 }} title="Close Inspector">
              <Icon icon="lucide:x" className="text-sm" />
            </button>
          </div>

          {/* Content — a single always-visible parameters view now that the
              per-node "Live Code Preview" tab has been dropped in favor of
              the top-level Code Preview view, which covers the same ground
              for the whole project rather than duplicating it per-node. */}
          <div
            className="flex-1 p-4 overflow-y-auto space-y-4"
            onFocusCapture={() => selectedNode && onStartEditing?.(selectedNode.id)}
            onBlurCapture={() => selectedNode && onEndEditing?.(selectedNode.id)}
          >
            {(() => {
              return selectedEdge ? (
                <EdgeInspector edge={selectedEdge} onUpdate={updateEdgeData} onDelete={deleteEdge} />
              ) : !selectedNode ? (
                nodes.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground text-xs select-none animate-in fade-in duration-200">
                    <Icon icon="lucide:layers" className="text-lg mb-2" style={{ color: 'var(--ink3)' }} />
                    <p className="font-semibold text-foreground text-sm">Canvas is empty</p>
                    <p className="text-[10px] text-muted-foreground mt-1 leading-normal max-w-[200px] mx-auto">
                      Add automation components to the canvas to configure parameters.
                    </p>
                  </div>
                ) : (
                  <CanvasSummary nodes={nodes} onSelectNode={setSelectedNodeId} />
                )
              ) : (
                <fieldset disabled={isReadOnly} className="space-y-3 border-0 p-0 m-0">
                  {isReadOnly && (
                    <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-start gap-2.5 mb-4 select-none">
                      <Icon icon="lucide:alert-circle" className="text-amber-500 text-base shrink-0 mt-0.5 animate-pulse" />
                      <div>
                        <p className="text-xs font-bold text-amber-400">Canvas Locked</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5 leading-normal">
                          Parameters are read-only while a pipeline run is active.
                        </p>
                      </div>
                    </div>
                  )}
                  {/* 1. TERRAFORM INSTANCE NODE PARAMETERS */}
                  {selectedNode.id.startsWith('aws_instance.web_server') && (
                    <>
                      {/* Tabs Header */}
                      <div className="flex border-b border-border mb-4">
                        <button
                          onClick={() => setActiveVmTab('aws')}
                          className={clsx(
                            "flex-1 pb-2 text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer border-b-2 text-center",
                            activeVmTab === 'aws'
                              ? "border-primary text-foreground"
                              : "border-transparent text-muted-foreground hover:text-foreground"
                          )}
                        >
                          AWS
                        </button>
                        <button
                          onClick={() => setActiveVmTab('gcp')}
                          className={clsx(
                            "flex-1 pb-2 text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer border-b-2 text-center",
                            activeVmTab === 'gcp'
                              ? "border-primary text-foreground"
                              : "border-transparent text-muted-foreground hover:text-foreground"
                          )}
                        >
                          GCP
                        </button>
                        <button
                          onClick={() => setActiveVmTab('azure')}
                          className={clsx(
                            "flex-1 pb-2 text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer border-b-2 text-center",
                            activeVmTab === 'azure'
                              ? "border-primary text-foreground"
                              : "border-transparent text-muted-foreground hover:text-foreground"
                          )}
                        >
                          Azure
                        </button>
                      </div>

                      {activeVmTab === 'aws' && (
                        <>
                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Instance Name</label>
                            <input
                              type="text"
                              value={p.instanceName || ''}
                              onChange={(e) => handleParameterChange('instanceName', e.target.value)}
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">AMI ID</label>
                              <input
                                type="text"
                                value={p.amiId || ''}
                                onChange={(e) => handleParameterChange('amiId', e.target.value)}
                                placeholder="e.g. ami-0abcdef1234567890"
                                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Instance Type</label>
                              <div className="relative">
                                <select
                                  value={p.instanceType || 't3.micro'}
                                  onChange={(e) => handleParameterChange('instanceType', e.target.value)}
                                  className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground appearance-none focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all cursor-pointer"
                                >
                                  <option value="t3.micro">t3.micro</option>
                                  <option value="t3.small">t3.small</option>
                                  <option value="t3.medium">t3.medium</option>
                                  <option value="t3.large">t3.large</option>
                                  <option value="m5.large">m5.large</option>
                                  <option value="m5.xlarge">m5.xlarge</option>
                                  <option value="c5.large">c5.large</option>
                                </select>
                                <Icon icon="lucide:chevron-down" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none" />
                              </div>
                            </div>
                          </div>

                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">VPC Subnet ID</label>
                            <InputWithVariablePicker
                              nodes={nodes}
                              onValueChange={(val) => handleParameterChange('subnetId', val)}
                              type="text"
                              value={p.subnetId || ''}
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Security Group ID</label>
                            <InputWithVariablePicker
                              nodes={nodes}
                              onValueChange={(val) => handleParameterChange('securityGroupId', val)}
                              type="text"
                              value={p.securityGroupId || ''}
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                            />
                          </div>

                          <div>
                            <div className="flex items-center justify-between mb-1 select-none">
                              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Root Volume Size</label>
                              <span className="text-xs font-semibold text-foreground">{p.rootVolumeSize || 50} GB</span>
                            </div>
                            <input
                              type="range"
                              min="8"
                              max="200"
                              value={p.rootVolumeSize || 50}
                              onChange={(e) => handleParameterChange('rootVolumeSize', parseInt(e.target.value))}
                              className="w-full accent-primary bg-muted h-1 rounded-lg appearance-none cursor-pointer"
                            />
                            <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1 select-none">
                              <span>8 GB</span>
                              <span>200 GB</span>
                            </div>
                          </div>

                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Tags</label>
                            <div className="flex flex-wrap gap-1.5 p-2 bg-muted border border-border rounded-lg">
                              {(p.tags || []).map((tag: Tag, idx: number) => (
                                <span key={idx} className="inline-flex items-center gap-1 bg-card px-2 py-0.5 rounded text-[10px] text-foreground border border-border">
                                  {tag.key}: {tag.value}
                                  <button onClick={() => handleTagDelete(idx)} className="text-muted-foreground hover:text-red-400 transition-colors cursor-pointer">
                                    <Icon icon="lucide:x" className="text-[10px]" />
                                  </button>
                                </span>
                              ))}
                              {!showAddTag ? (
                                <button
                                  onClick={() => setShowAddTag(true)}
                                  className="text-[10px] text-primary hover:text-primary/90 font-semibold px-2 py-0.5 flex items-center gap-1 cursor-pointer"
                                >
                                  <Icon icon="lucide:plus" className="text-xs" /> Add tag
                                </button>
                              ) : (
                                <form onSubmit={handleTagAdd} className="flex items-center gap-1 w-full mt-1">
                                  <input
                                    type="text"
                                    placeholder="Key"
                                    value={newTagKey}
                                    onChange={(e) => setNewTagKey(e.target.value)}
                                    className="bg-card border border-border rounded px-1.5 py-0.5 text-[10px] w-1/2 text-foreground focus:outline-none"
                                  />
                                  <input
                                    type="text"
                                    placeholder="Value"
                                    value={newTagVal}
                                    onChange={(e) => setNewTagVal(e.target.value)}
                                    className="bg-card border border-border rounded px-1.5 py-0.5 text-[10px] w-1/2 text-foreground focus:outline-none"
                                  />
                                  <button type="submit" className="text-emerald-400 hover:text-emerald-300 cursor-pointer">
                                    <Icon icon="lucide:check" className="text-xs" />
                                  </button>
                                  <button type="button" onClick={() => setShowAddTag(false)} className="text-rose-400 hover:text-rose-300 cursor-pointer">
                                    <Icon icon="lucide:x" className="text-xs" />
                                  </button>
                                </form>
                              )}
                            </div>
                          </div>
                        </>
                      )}

                      {activeVmTab === 'gcp' && (
                        <>
                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Instance Name</label>
                            <input
                              type="text"
                              value={p.gcpInstanceName || ''}
                              onChange={(e) => handleParameterChange('gcpInstanceName', e.target.value)}
                              placeholder="e.g. web-server"
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Machine Type</label>
                              <div className="relative">
                                <select
                                  value={p.gcpMachineType || 'e2-micro'}
                                  onChange={(e) => handleParameterChange('gcpMachineType', e.target.value)}
                                  className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground appearance-none focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all cursor-pointer"
                                >
                                  <option value="e2-micro">e2-micro</option>
                                  <option value="e2-small">e2-small</option>
                                  <option value="e2-medium">e2-medium</option>
                                  <option value="n2-standard-2">n2-standard-2</option>
                                  <option value="n2-standard-4">n2-standard-4</option>
                                </select>
                                <Icon icon="lucide:chevron-down" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none" />
                              </div>
                            </div>
                            <div>
                              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Image</label>
                              <input
                                type="text"
                                value={p.gcpImage || 'ubuntu-os-cloud/ubuntu-2204-lts'}
                                onChange={(e) => handleParameterChange('gcpImage', e.target.value)}
                                placeholder="ubuntu-os-cloud/ubuntu-2204-lts"
                                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">VPC Network</label>
                            <input
                              type="text"
                              value={p.gcpNetwork || 'default'}
                              onChange={(e) => handleParameterChange('gcpNetwork', e.target.value)}
                              placeholder="default"
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                            />
                          </div>

                          <div>
                            <div className="flex items-center justify-between mb-1 select-none">
                              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Disk Size</label>
                              <span className="text-xs font-semibold text-foreground">{p.gcpDiskSize || 50} GB</span>
                            </div>
                            <input
                              type="range"
                              min="10"
                              max="500"
                              value={p.gcpDiskSize || 50}
                              onChange={(e) => handleParameterChange('gcpDiskSize', parseInt(e.target.value))}
                              className="w-full accent-primary bg-muted h-1 rounded-lg appearance-none cursor-pointer"
                            />
                            <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1 select-none">
                              <span>10 GB</span>
                              <span>500 GB</span>
                            </div>
                          </div>
                        </>
                      )}

                      {activeVmTab === 'azure' && (
                        <>
                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">VM Name</label>
                            <input
                              type="text"
                              value={p.azureVmName || ''}
                              onChange={(e) => handleParameterChange('azureVmName', e.target.value)}
                              placeholder="e.g. web-vm"
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Size (SKU)</label>
                              <div className="relative">
                                <select
                                  value={p.azureVmSize || 'Standard_B1s'}
                                  onChange={(e) => handleParameterChange('azureVmSize', e.target.value)}
                                  className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground appearance-none focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all cursor-pointer"
                                >
                                  <option value="Standard_B1s">Standard_B1s</option>
                                  <option value="Standard_B1ms">Standard_B1ms</option>
                                  <option value="Standard_B2s">Standard_B2s</option>
                                  <option value="Standard_D2s_v3">Standard_D2s_v3</option>
                                </select>
                                <Icon icon="lucide:chevron-down" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none" />
                              </div>
                            </div>
                            <div>
                              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Publisher</label>
                              <input
                                type="text"
                                value={p.azurePublisher || 'Canonical'}
                                onChange={(e) => handleParameterChange('azurePublisher', e.target.value)}
                                placeholder="Canonical"
                                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Offer</label>
                              <input
                                type="text"
                                value={p.azureOffer || 'UbuntuServer'}
                                onChange={(e) => handleParameterChange('azureOffer', e.target.value)}
                                placeholder="UbuntuServer"
                                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">SKU</label>
                              <input
                                type="text"
                                value={p.azureSku || '18.04-LTS'}
                                onChange={(e) => handleParameterChange('azureSku', e.target.value)}
                                placeholder="18.04-LTS"
                                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                              />
                            </div>
                          </div>

                          <div>
                            <div className="flex items-center justify-between mb-1 select-none">
                              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">OS Disk Size</label>
                              <span className="text-xs font-semibold text-foreground">{p.azureDiskSize || 50} GB</span>
                            </div>
                            <input
                              type="range"
                              min="30"
                              max="1024"
                              value={p.azureDiskSize || 50}
                              onChange={(e) => handleParameterChange('azureDiskSize', parseInt(e.target.value))}
                              className="w-full accent-primary bg-muted h-1 rounded-lg appearance-none cursor-pointer"
                            />
                            <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1 select-none">
                              <span>30 GB</span>
                              <span>1024 GB</span>
                            </div>
                          </div>
                        </>
                      )}
                    </>
                  )}

                  {selectedNode.id.startsWith('aws_security_group') && (
                    <>
                      <div>
                        <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Security Group Name</label>
                        <input
                          type="text"
                          value={p.sgName}
                          onChange={(e) => handleParameterChange('sgName', e.target.value)}
                          className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Description</label>
                        <input
                          type="text"
                          value={p.description}
                          onChange={(e) => handleParameterChange('description', e.target.value)}
                          className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">HTTP Port</label>
                          <input
                            type="number"
                            value={p.httpPort ?? 80}
                            onChange={(e) => handleParameterChange('httpPort', parseInt(e.target.value))}
                            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">HTTPS Port</label>
                          <input
                            type="number"
                            value={p.httpsPort ?? 443}
                            onChange={(e) => handleParameterChange('httpsPort', parseInt(e.target.value))}
                            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Allowed CIDR</label>
                        <InputWithVariablePicker
                          nodes={nodes}
                          onValueChange={(val) => handleParameterChange('allowedCidr', val)}
                          type="text"
                          value={p.allowedCidr || '0.0.0.0/0'}
                          className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">VPC Link ID</label>
                        <InputWithVariablePicker
                          nodes={nodes}
                          onValueChange={(val) => handleParameterChange('vpcId', val)}
                          type="text"
                          value={p.vpcId || ''}
                          className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                        />
                      </div>

                      <div className="flex items-center justify-between bg-muted border border-border rounded-lg px-3 py-2.5">
                        <div>
                          <p className="text-xs font-semibold text-foreground">Enable SSH Access</p>
                          <p className="text-[10px] text-muted-foreground">Opens port 22 (TCP)</p>
                        </div>
                        <button
                          onClick={() => handleParameterChange('sshEnabled', !p.sshEnabled)}
                          className={clsx(
                            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none",
                            p.sshEnabled !== false ? "bg-primary" : "bg-muted-foreground/30"
                          )}
                        >
                          <span className={clsx(
                            "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200",
                            p.sshEnabled !== false ? "translate-x-4" : "translate-x-0"
                          )} />
                        </button>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Inbound Allowed Ports (Fallback)</label>
                        <input
                          type="text"
                          value={p.ingressPorts || '80, 443, 22'}
                          onChange={(e) => handleParameterChange('ingressPorts', e.target.value)}
                          placeholder="e.g. 80, 443, 22"
                          className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                        />
                      </div>
                    </>
                  )}

                  {selectedNode.id.startsWith('aws_s3_bucket') && (
                    <>
                      <div>
                        <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Bucket Name</label>
                        <input
                          type="text"
                          value={p.bucketName}
                          onChange={(e) => handleParameterChange('bucketName', e.target.value)}
                          className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                        />
                      </div>
                      <div className="flex items-center justify-between p-2.5 bg-muted rounded-lg border border-border select-none">
                        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider font-heading">Versioning Enabled</span>
                        <input
                          type="checkbox"
                          checked={p.versioningEnabled}
                          onChange={(e) => handleParameterChange('versioningEnabled', e.target.checked)}
                          className="h-4 w-4 rounded border-border bg-muted text-primary focus:ring-primary focus:ring-offset-0 cursor-pointer"
                        />
                      </div>
                      <div className="flex items-center justify-between p-2.5 bg-muted rounded-lg border border-border select-none">
                        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider font-heading">Force Destroy on Teardown</span>
                        <input
                          type="checkbox"
                          checked={p.forceDestroy}
                          onChange={(e) => handleParameterChange('forceDestroy', e.target.checked)}
                          className="h-4 w-4 rounded border-border bg-muted text-primary focus:ring-primary focus:ring-offset-0 cursor-pointer"
                        />
                      </div>
                    </>
                  )}

                  {selectedNode.id.startsWith('aws_db_instance') && (
                    <>
                      <div>
                        <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">DB Identifier/Name</label>
                        <input
                          type="text"
                          value={p.dbName}
                          onChange={(e) => handleParameterChange('dbName', e.target.value)}
                          className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Engine Version</label>
                          <input
                            type="text"
                            value={p.engineVersion}
                            onChange={(e) => handleParameterChange('engineVersion', e.target.value)}
                            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Instance Class</label>
                          <select
                            value={p.instanceClass}
                            onChange={(e) => handleParameterChange('instanceClass', e.target.value)}
                            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none cursor-pointer transition-all"
                          >
                            <option value="db.t3.micro">db.t3.micro</option>
                            <option value="db.t3.medium">db.t3.medium</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Allocated Storage (GB)</label>
                        <input
                          type="number"
                          value={p.allocatedStorage}
                          onChange={(e) => handleParameterChange('allocatedStorage', parseInt(e.target.value) || 20)}
                          className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Master Username</label>
                          <input
                            type="text"
                            value={p.username}
                            onChange={(e) => handleParameterChange('username', e.target.value)}
                            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Master Password</label>
                          <input
                            type="password"
                            value={p.password}
                            onChange={(e) => handleParameterChange('password', e.target.value)}
                            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">VPC Security Group IDs</label>
                        <InputWithVariablePicker
                          nodes={nodes}
                          onValueChange={(val) => handleParameterChange('vpcSecurityGroupIds', val)}
                          type="text"
                          value={p.vpcSecurityGroupIds || ''}
                          className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">DB Subnet Group Name</label>
                        <InputWithVariablePicker
                          nodes={nodes}
                          onValueChange={(val) => handleParameterChange('dbSubnetGroupName', val)}
                          type="text"
                          value={p.dbSubnetGroupName || ''}
                          className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                        />
                      </div>
                    </>
                  )}

                  {selectedNode.id.startsWith('aws_vpc') && (
                    <>
                      <div>
                        <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">VPC Name</label>
                        <input
                          type="text"
                          value={p.vpcName}
                          onChange={(e) => handleParameterChange('vpcName', e.target.value)}
                          className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">CIDR Block</label>
                        <input
                          type="text"
                          value={p.cidrBlock}
                          onChange={(e) => handleParameterChange('cidrBlock', e.target.value)}
                          placeholder="10.0.0.0/16"
                          className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                        />
                      </div>
                      <div className="flex items-center justify-between p-2.5 bg-muted rounded-lg border border-border select-none">
                        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider font-heading">Enable DNS Hostnames</span>
                        <input
                          type="checkbox"
                          checked={p.enableDnsHostnames}
                          onChange={(e) => handleParameterChange('enableDnsHostnames', e.target.checked)}
                          className="h-4 w-4 rounded border-border bg-muted text-primary focus:ring-primary focus:ring-offset-0 cursor-pointer"
                        />
                      </div>
                    </>
                  )}

                  {selectedNode.id.startsWith('aws_subnet') && (
                    <>
                      <div>
                        <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Subnet Name</label>
                        <input
                          type="text"
                          value={p.subnetName}
                          onChange={(e) => handleParameterChange('subnetName', e.target.value)}
                          className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">VPC Link ID</label>
                        <input
                          type="text"
                          value={p.vpcId}
                          onChange={(e) => handleParameterChange('vpcId', e.target.value)}
                          placeholder="e.g. aws_vpc.app_vpc.id"
                          className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">CIDR Block</label>
                          <input
                            type="text"
                            value={p.cidrBlock}
                            onChange={(e) => handleParameterChange('cidrBlock', e.target.value)}
                            placeholder="10.0.1.0/24"
                            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Availability Zone</label>
                          <input
                            type="text"
                            value={p.availabilityZone}
                            onChange={(e) => handleParameterChange('availabilityZone', e.target.value)}
                            placeholder="us-east-1a"
                            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-between p-2.5 bg-muted rounded-lg border border-border select-none">
                        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider font-heading">Map Public IP on Launch</span>
                        <input
                          type="checkbox"
                          checked={p.mapPublicIp}
                          onChange={(e) => handleParameterChange('mapPublicIp', e.target.checked)}
                          className="h-4 w-4 rounded border-border bg-muted text-primary focus:ring-primary focus:ring-offset-0 cursor-pointer"
                        />
                      </div>
                    </>
                  )}

                  {/* 2. ANSIBLE DYNAMIC NODE PARAMETERS (VARIABLES) */}
                  {selectedNode.data.tech === 'Ansible' && (
                    <div className="space-y-4">
                      <p className="text-[11px] text-muted-foreground">Ansible playbooks support variable binding using `{`{ variable }`}`. Click `{`{x}`}` to convert hardcoded values to variables.</p>
                      
                      {/* Connection Settings */}
                      <div className="bg-muted/40 border border-border rounded-xl p-3 space-y-3">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                          <Icon icon="lucide:settings" className="text-primary text-xs" /> Target Connection Settings
                        </span>
                        <div>
                          <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Target Host IP</label>
                          <InputWithVariablePicker
                            nodes={nodes}
                            onValueChange={(val) => handleParameterChange('ansibleHost', val)}
                            type="text"
                            value={p.ansibleHost || ''}
                            placeholder="e.g. 127.0.0.1 or {{ nodes.web_server.public_ip }}"
                            className="w-full bg-muted border border-border rounded-lg px-2.5 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Target SSH User</label>
                          <input
                            type="text"
                            value={p.ansibleUser || 'ubuntu'}
                            onChange={(e) => handleParameterChange('ansibleUser', e.target.value)}
                            placeholder="e.g. ubuntu or ec2-user"
                            className="w-full bg-muted border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all font-mono"
                          />
                        </div>
                      </div>
                      
                      {nodeLabel.includes('Open Port') && (
                        <div>
                          <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Open Firewall Port</label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={portVal}
                              onChange={(e) => updateNodeData(selectedNode.id, { port: e.target.value })}
                              placeholder="e.g. 80 or {{ port }}"
                              className="flex-1 bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all font-mono"
                            />
                            <button
                              onClick={() => {
                                const current = portVal || 'port_number';
                                if (!current.startsWith('{{')) {
                                  updateNodeData(selectedNode.id, { port: `{{ ${current} }}` });
                                }
                              }}
                              className="px-3 bg-muted border border-border rounded-lg text-muted-foreground hover:text-primary transition-all font-mono text-xs cursor-pointer flex items-center justify-center"
                              title="Convert to Variable"
                            >
                              {'{x}'}
                            </button>
                          </div>
                        </div>
                      )}

                      {(nodeLabel.includes('PostgreSQL') || nodeLabel.includes('Postgres')) && (
                        <>
                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Database User</label>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={dbUserVal}
                                onChange={(e) => updateNodeData(selectedNode.id, { dbUser: e.target.value })}
                                placeholder="e.g. admin or {{ db_user }}"
                                className="flex-1 bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all font-mono"
                              />
                              <button
                                onClick={() => {
                                  const current = dbUserVal || 'db_user';
                                  if (!current.startsWith('{{')) {
                                    updateNodeData(selectedNode.id, { dbUser: `{{ ${current} }}` });
                                  }
                                }}
                                className="px-3 bg-muted border border-border rounded-lg text-muted-foreground hover:text-primary transition-all font-mono text-xs cursor-pointer flex items-center justify-center"
                                title="Convert to Variable"
                              >
                                {'{x}'}
                              </button>
                            </div>
                          </div>

                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Database Password</label>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={dbPassVal}
                                onChange={(e) => updateNodeData(selectedNode.id, { dbPass: e.target.value })}
                                placeholder="e.g. password or {{ db_pass }}"
                                className="flex-1 bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all font-mono"
                              />
                              <button
                                onClick={() => {
                                  const current = dbPassVal || 'db_pass';
                                  if (!current.startsWith('{{')) {
                                    updateNodeData(selectedNode.id, { dbPass: `{{ ${current} }}` });
                                  }
                                }}
                                className="px-3 bg-muted border border-border rounded-lg text-muted-foreground hover:text-primary transition-all font-mono text-xs cursor-pointer flex items-center justify-center"
                                title="Convert to Variable"
                              >
                                {'{x}'}
                              </button>
                            </div>
                          </div>
                        </>
                      )}

                      {nodeLabel.includes('Deploy Node App') && (
                        <div className="space-y-4">
                          <p className="text-[11px] text-muted-foreground">
                            Requires a Code Repository node connected upstream — this task copies its cloned code onto the server, installs dependencies, and keeps it running with pm2.
                          </p>
                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Start Command</label>
                            <input
                              type="text"
                              value={startCommandVal}
                              onChange={(e) => updateNodeData(selectedNode.id, { startCommand: e.target.value })}
                              placeholder="npm start"
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">App Port</label>
                            <input
                              type="text"
                              value={appPortVal}
                              onChange={(e) => updateNodeData(selectedNode.id, { appPort: e.target.value })}
                              placeholder="3000"
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                            />
                          </div>
                        </div>
                      )}

                      {selectedNode.id.startsWith('apt_install') && (
                        <div className="space-y-3">
                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Packages to Install</label>
                            <input
                              type="text"
                              value={p.packages}
                              onChange={(e) => handleParameterChange('packages', e.target.value)}
                              placeholder="e.g. curl, git, jq"
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Desired State</label>
                            <select
                              value={p.state}
                              onChange={(e) => handleParameterChange('state', e.target.value)}
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary cursor-pointer transition-all"
                            >
                              <option value="present">present</option>
                              <option value="latest">latest</option>
                            </select>
                          </div>
                        </div>
                      )}

                      {selectedNode.id.startsWith('create_user') && (
                        <div className="space-y-3">
                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Username</label>
                            <input
                              type="text"
                              value={p.username}
                              onChange={(e) => handleParameterChange('username', e.target.value)}
                              placeholder="deployer"
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Login Shell</label>
                            <input
                              type="text"
                              value={p.shell}
                              onChange={(e) => handleParameterChange('shell', e.target.value)}
                              placeholder="/bin/bash"
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all font-mono"
                            />
                          </div>
                          <div className="flex items-center justify-between p-2 bg-muted rounded-lg border border-border select-none">
                            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Create Home Directory</span>
                            <input
                              type="checkbox"
                              checked={p.createHome}
                              onChange={(e) => handleParameterChange('createHome', e.target.checked)}
                              className="h-4 w-4 rounded border-border bg-muted text-primary focus:ring-primary focus:ring-offset-0 cursor-pointer"
                            />
                          </div>
                        </div>
                      )}

                      {selectedNode.id.startsWith('systemd_service') && (
                        <div className="space-y-3">
                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Service Name</label>
                            <input
                              type="text"
                              value={p.serviceName}
                              onChange={(e) => handleParameterChange('serviceName', e.target.value)}
                              placeholder="nginx"
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Desired State</label>
                            <select
                              value={p.state}
                              onChange={(e) => handleParameterChange('state', e.target.value)}
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary cursor-pointer transition-all"
                            >
                              <option value="started">started</option>
                              <option value="stopped">stopped</option>
                              <option value="restarted">restarted</option>
                            </select>
                          </div>
                          <div className="flex items-center justify-between p-2 bg-muted rounded-lg border border-border select-none">
                            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Enabled on Boot</span>
                            <input
                              type="checkbox"
                              checked={p.enabled}
                              onChange={(e) => handleParameterChange('enabled', e.target.checked)}
                              className="h-4 w-4 rounded border-border bg-muted text-primary focus:ring-primary focus:ring-offset-0 cursor-pointer"
                            />
                          </div>
                        </div>
                      )}

                      {selectedNode.id.startsWith('git_clone') && (
                        <div className="space-y-3">
                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Git Repository URL</label>
                            <input
                              type="text"
                              value={p.repoUrl || ''}
                              onChange={(e) => {
                                handleParameterChange('repoUrl', e.target.value);
                                updateNodeData(selectedNode.id, { repoUrl: e.target.value });
                              }}
                              placeholder="https://github.com/org/repo.git"
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Destination Path</label>
                            <input
                              type="text"
                              value={p.destPath || ''}
                              onChange={(e) => {
                                handleParameterChange('destPath', e.target.value);
                                updateNodeData(selectedNode.id, { destPath: e.target.value });
                              }}
                              placeholder="/var/www/app"
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Version / Branch</label>
                            <input
                              type="text"
                              value={p.branch || ''}
                              onChange={(e) => {
                                handleParameterChange('branch', e.target.value);
                                updateNodeData(selectedNode.id, { branch: e.target.value });
                              }}
                              placeholder="main"
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">GitHub Credential (for Private Repos)</label>
                            <div className="relative">
                              <select
                                value={p.credentialId || ''}
                                onChange={(e) => {
                                  handleParameterChange('credentialId', e.target.value);
                                  updateNodeData(selectedNode.id, { credentialId: e.target.value });
                                }}
                                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground appearance-none focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all cursor-pointer"
                              >
                                <option value="">-- Public Repository (No Auth) --</option>
                                {availableCredentials.filter(c => c.provider === 'GITHUB').map(c => (
                                  <option key={c.id} value={c.id}>{c.name} ({c.key_fingerprint})</option>
                                ))}
                              </select>
                              <Icon icon="lucide:chevron-down" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none" />
                            </div>
                          </div>
                        </div>
                      )}

                      {selectedNode.id.startsWith('shell_command') && (
                        <div className="space-y-3">
                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Command to execute</label>
                            <input
                              type="text"
                              value={p.command}
                              onChange={(e) => handleParameterChange('command', e.target.value)}
                              placeholder="echo 'hello world'"
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Working Directory (chdir)</label>
                            <input
                              type="text"
                              value={p.chdir}
                              onChange={(e) => handleParameterChange('chdir', e.target.value)}
                              placeholder="/tmp"
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all font-mono"
                            />
                          </div>
                        </div>
                      )}

                      {selectedNode.id.startsWith('file_copy') && (
                        <div className="space-y-3">
                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Source File Path</label>
                            <input
                              type="text"
                              value={p.srcPath}
                              onChange={(e) => handleParameterChange('srcPath', e.target.value)}
                              placeholder="config.json"
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Destination Remote Path</label>
                            <input
                              type="text"
                              value={p.destPath}
                              onChange={(e) => handleParameterChange('destPath', e.target.value)}
                              placeholder="/var/www/app/config.json"
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all font-mono"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Owner</label>
                              <input
                                type="text"
                                value={p.owner}
                                onChange={(e) => handleParameterChange('owner', e.target.value)}
                                placeholder="www-data"
                                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Permissions Mode</label>
                              <input
                                type="text"
                                value={p.mode}
                                onChange={(e) => handleParameterChange('mode', e.target.value)}
                                placeholder="0644"
                                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none"
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {!nodeLabel.includes('Open Port') &&
                       !nodeLabel.includes('Postgres') &&
                       !nodeLabel.includes('PostgreSQL') &&
                       !nodeLabel.includes('Deploy Node App') &&
                       !selectedNode.id.startsWith('apt_install') &&
                       !selectedNode.id.startsWith('create_user') &&
                       !selectedNode.id.startsWith('systemd_service') &&
                       !selectedNode.id.startsWith('git_clone') &&
                       !selectedNode.id.startsWith('shell_command') &&
                       !selectedNode.id.startsWith('file_copy') && (
                        <div className="text-center py-6 text-muted-foreground text-xs select-none">
                          No custom variables to configure for this Ansible block.
                        </div>
                      )}
                    </div>
                  )}

                   {/* 2c. TARGET NODE PARAMETERS */}
                  {selectedNode.data.tech === 'Target' && (
                    <div className="space-y-4">
                      {selectedNode.id.startsWith('aws_target') ? (
                        <>
                          <p className="text-[11px] text-muted-foreground">
                            Chooses which AWS environment Terraform provisions into. LocalStack sandbox for testing, live AWS cloud for production.
                          </p>
                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Environment</label>
                            <div className="relative">
                              <select
                                  value={environmentVal}
                                  onChange={(e) => updateNodeData(selectedNode.id, { environment: e.target.value })}
                                  className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground appearance-none focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all cursor-pointer"
                              >
                                <option value="localstack">LocalStack (Sandbox)</option>
                                <option value="aws">Live AWS (Cloud)</option>
                              </select>
                              <Icon icon="lucide:chevron-down" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none" />
                            </div>
                          </div>

                          {environmentVal === 'aws' && (
                            <div>
                              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">AWS Credential Source</label>
                              <div className="relative">
                                <select
                                    value={credentialIdVal}
                                    onChange={(e) => updateNodeData(selectedNode.id, { credentialId: e.target.value })}
                                    className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground appearance-none focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all cursor-pointer"
                                >
                                  <option value="">-- Select AWS Credential --</option>
                                  {availableCredentials.filter(c => c.provider === 'AWS').map(c => (
                                    <option key={c.id} value={c.id}>{c.name} ({c.key_fingerprint})</option>
                                  ))}
                                </select>
                                <Icon icon="lucide:chevron-down" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none" />
                              </div>
                            </div>
                          )}

                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">AWS Region</label>
                            <input
                              type="text"
                              value={regionVal}
                              onChange={(e) => updateNodeData(selectedNode.id, { region: e.target.value })}
                              placeholder="us-east-1"
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                            />
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="text-[11px] text-muted-foreground">
                            Chooses which GCP project and zone to deploy into.
                          </p>
                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Environment</label>
                            <div className="relative">
                              <select
                                  value={environmentVal}
                                  onChange={(e) => updateNodeData(selectedNode.id, { environment: e.target.value })}
                                  className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground appearance-none focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all cursor-pointer"
                              >
                                <option value="gcp">Live GCP (Cloud)</option>
                              </select>
                              <Icon icon="lucide:chevron-down" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none" />
                            </div>
                          </div>

                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">GCP Service Account JSON</label>
                            <div className="relative">
                              <select
                                  value={credentialIdVal}
                                  onChange={(e) => updateNodeData(selectedNode.id, { credentialId: e.target.value })}
                                  className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground appearance-none focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all cursor-pointer"
                              >
                                <option value="">-- Select GCP Service Account --</option>
                                {availableCredentials.filter(c => c.provider === 'GCP').map(c => (
                                  <option key={c.id} value={c.id}>{c.name} ({c.key_fingerprint})</option>
                                ))}
                              </select>
                              <Icon icon="lucide:chevron-down" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none" />
                            </div>
                          </div>

                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">GCP Project ID</label>
                            <input
                              type="text"
                              value={projectIDVal}
                              onChange={(e) => updateNodeData(selectedNode.id, { projectId: e.target.value })}
                              placeholder="whiparc-prod-12345"
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">GCP Region</label>
                            <input
                              type="text"
                              value={regionVal}
                              onChange={(e) => updateNodeData(selectedNode.id, { region: e.target.value })}
                              placeholder="us-central1"
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">GCP Zone</label>
                            <input
                              type="text"
                              value={gcpZoneVal}
                              onChange={(e) => updateNodeData(selectedNode.id, { gcpZone: e.target.value })}
                              placeholder="us-central1-a"
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                            />
                          </div>
                        </>
                      )}

                      {/* COMMON SSH KEY CONFIGURATION */}
                      <div>
                        <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Ansible SSH Target Private Key</label>
                        <div className="relative">
                          <select
                              value={sshKeyIdVal}
                              onChange={(e) => updateNodeData(selectedNode.id, { sshKeyId: e.target.value })}
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground appearance-none focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all cursor-pointer"
                          >
                            <option value="">-- Select SSH Key (.pem) --</option>
                            {availableCredentials.filter(c => c.provider === 'SSH').map(c => (
                              <option key={c.id} value={c.id}>{c.name} ({c.key_fingerprint})</option>
                            ))}
                          </select>
                          <Icon icon="lucide:chevron-down" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none" />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 2d. KUBERNETES NODE PARAMETERS */}
                  {selectedNode.data.tech === 'Kubernetes' && (
                    <div className="space-y-4">
                      {selectedNode.id.startsWith('k8s_deployment') && (
                        <div className="space-y-3">
                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Deployment Name</label>
                            <input
                              type="text"
                              value={p.deploymentName}
                              onChange={(e) => handleParameterChange('deploymentName', e.target.value)}
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Replicas</label>
                              <input
                                type="number"
                                value={p.replicas}
                                onChange={(e) => handleParameterChange('replicas', parseInt(e.target.value) || 1)}
                                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Container Port</label>
                              <input
                                type="number"
                                value={p.containerPort}
                                onChange={(e) => handleParameterChange('containerPort', parseInt(e.target.value) || 80)}
                                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all font-mono"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Container Image</label>
                            <input
                              type="text"
                              value={p.imageName}
                              onChange={(e) => handleParameterChange('imageName', e.target.value)}
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">CPU Request/Limit</label>
                              <input
                                type="text"
                                value={p.cpuLimit}
                                onChange={(e) => handleParameterChange('cpuLimit', e.target.value)}
                                placeholder="500m"
                                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Memory Request/Limit</label>
                              <input
                                type="text"
                                value={p.memoryLimit}
                                onChange={(e) => handleParameterChange('memoryLimit', e.target.value)}
                                placeholder="512Mi"
                                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {selectedNode.id.startsWith('k8s_service') && (
                        <div className="space-y-3">
                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Service Name</label>
                            <input
                              type="text"
                              value={p.serviceName}
                              onChange={(e) => handleParameterChange('serviceName', e.target.value)}
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Service Type</label>
                            <select
                              value={p.serviceType}
                              onChange={(e) => handleParameterChange('serviceType', e.target.value)}
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none cursor-pointer"
                            >
                              <option value="ClusterIP">ClusterIP</option>
                              <option value="NodePort">NodePort</option>
                              <option value="LoadBalancer">LoadBalancer</option>
                            </select>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">External Port</label>
                              <input
                                type="number"
                                value={p.port}
                                onChange={(e) => handleParameterChange('port', parseInt(e.target.value) || 80)}
                                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground font-mono"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Target Port</label>
                              <input
                                type="number"
                                value={p.targetPort}
                                onChange={(e) => handleParameterChange('targetPort', parseInt(e.target.value) || 80)}
                                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground font-mono"
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {selectedNode.id.startsWith('k8s_configmap') && (
                        <div className="space-y-3">
                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">ConfigMap Name</label>
                            <input
                              type="text"
                              value={p.configMapName}
                              onChange={(e) => handleParameterChange('configMapName', e.target.value)}
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Data Key</label>
                              <input
                                type="text"
                                value={p.dataKey}
                                onChange={(e) => handleParameterChange('dataKey', e.target.value)}
                                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Data Value</label>
                              <input
                                type="text"
                                value={p.dataValue}
                                onChange={(e) => handleParameterChange('dataValue', e.target.value)}
                                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono"
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {selectedNode.id.startsWith('k8s_secret') && (
                        <div className="space-y-3">
                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Secret Name</label>
                            <input
                              type="text"
                              value={p.secretName}
                              onChange={(e) => handleParameterChange('secretName', e.target.value)}
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Secret Key</label>
                              <input
                                type="text"
                                value={p.secretKey}
                                onChange={(e) => handleParameterChange('secretKey', e.target.value)}
                                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Secret Value</label>
                              <input
                                type="password"
                                value={p.secretValue}
                                onChange={(e) => handleParameterChange('secretValue', e.target.value)}
                                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground"
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {selectedNode.id.startsWith('k8s_ingress') && (
                        <div className="space-y-3">
                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Ingress Name</label>
                            <input
                              type="text"
                              value={p.ingressName}
                              onChange={(e) => handleParameterChange('ingressName', e.target.value)}
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Routing Host Rule</label>
                            <input
                              type="text"
                              value={p.host}
                              onChange={(e) => handleParameterChange('host', e.target.value)}
                              placeholder="app.local"
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Path</label>
                              <input
                                type="text"
                                value={p.path}
                                onChange={(e) => handleParameterChange('path', e.target.value)}
                                placeholder="/"
                                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Target Service Port</label>
                              <input
                                type="number"
                                value={p.servicePort}
                                onChange={(e) => handleParameterChange('servicePort', parseInt(e.target.value) || 80)}
                                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Target K8s Service</label>
                            <input
                              type="text"
                              value={p.serviceName}
                              onChange={(e) => handleParameterChange('serviceName', e.target.value)}
                              placeholder="app-service"
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono"
                            />
                          </div>
                        </div>
                      )}

                      {selectedNode.id.startsWith('k8s_pvc') && (
                        <div className="space-y-3">
                          <div>
                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Volume Claim Name</label>
                            <input
                              type="text"
                              value={p.pvcName}
                              onChange={(e) => handleParameterChange('pvcName', e.target.value)}
                              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Storage Request</label>
                              <input
                                type="text"
                                value={p.storageSize}
                                onChange={(e) => handleParameterChange('storageSize', e.target.value)}
                                placeholder="10Gi"
                                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Storage Class</label>
                              <input
                                type="text"
                                value={p.storageClass}
                                onChange={(e) => handleParameterChange('storageClass', e.target.value)}
                                placeholder="standard"
                                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground"
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 3. STATIC / MOCK NODES */}
                  {selectedNode.data.tech !== 'Ansible' && selectedNode.data.tech !== 'Source' && selectedNode.data.tech !== 'Target' && selectedNode.data.tech !== 'Kubernetes' && !selectedNode.id.startsWith('aws_instance.web_server') && !selectedNode.id.startsWith('aws_security_group') && !selectedNode.id.startsWith('aws_s3_bucket') && !selectedNode.id.startsWith('aws_db_instance') && !selectedNode.id.startsWith('aws_vpc') && !selectedNode.id.startsWith('aws_subnet') && (
                    <div className="text-center py-6 text-muted-foreground text-xs select-none">
                      No custom parameters defined for this mock infrastructure block.
                    </div>
                  )}
                </fieldset>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Collapse Trigger Button */}
      <button
        onClick={onToggle}
        className="absolute -left-4 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full border border-border bg-card flex items-center justify-center text-muted-foreground hover:text-foreground shadow-md hover:shadow-primary/10 transition-all z-30 cursor-pointer"
        title="Toggle Inspector Panel"
      >
        <Icon icon={collapsed ? "lucide:arrow-left" : "lucide:arrow-right"} className="text-xs" />
      </button>
    </aside>
  );
};

// --- DEFAULT PARAMETERS FOR NODES ---
function getDefaultParametersForNode(nodeId: string): Record<string, unknown> {
  if (nodeId.startsWith('aws_instance.web_server')) {
    return {
      instanceName: 'web_server',
      amiId: 'ami-785db401',
      instanceType: 't3.medium',
      subnetId: 'subnet-0123456789abcdef0',
      securityGroupId: '',
      rootVolumeSize: 50,
      tags: [
        { key: 'Environment', value: 'prod' },
        { key: 'Role', value: 'web' }
      ]
    };
  }
  if (nodeId.startsWith('aws_security_group')) {
    return {
      sgName: 'web_sg',
      vpcId: '',
      description: 'Allows HTTP/HTTPS inbound & SSH access',
      ingressPorts: '80, 443, 22'
    };
  }
  if (nodeId.startsWith('aws_s3_bucket')) {
    return {
      bucketName: 'whiparc-user-bucket',
      forceDestroy: true,
      versioningEnabled: true
    };
  }
  if (nodeId.startsWith('aws_db_instance')) {
    return {
      dbName: 'appdb',
      allocatedStorage: 20,
      instanceClass: 'db.t3.micro',
      username: 'dbadmin',
      password: 'SuperSecurePassword123!',
      engineVersion: '14.1',
      vpcSecurityGroupIds: '',
      dbSubnetGroupName: ''
    };
  }
  if (nodeId.startsWith('aws_vpc')) {
    return {
      vpcName: 'app_vpc',
      cidrBlock: '10.0.0.0/16',
      enableDnsHostnames: true
    };
  }
  if (nodeId.startsWith('aws_subnet')) {
    return {
      subnetName: 'app_subnet_1a',
      vpcId: 'aws_vpc.app_vpc.id',
      cidrBlock: '10.0.1.0/24',
      availabilityZone: 'us-east-1a',
      mapPublicIp: true
    };
  }
  // Ansible Nodes
  if (nodeId.startsWith('apt_install')) {
    return {
      packages: 'curl, git, jq',
      state: 'present',
      ansibleHost: '',
      ansibleUser: 'ubuntu'
    };
  }
  if (nodeId.startsWith('create_user')) {
    return {
      username: 'deployer',
      shell: '/bin/bash',
      createHome: true,
      ansibleHost: '',
      ansibleUser: 'ubuntu'
    };
  }
  if (nodeId.startsWith('systemd_service')) {
    return {
      serviceName: 'nginx',
      state: 'started',
      enabled: true,
      ansibleHost: '',
      ansibleUser: 'ubuntu'
    };
  }
  if (nodeId.startsWith('git_clone')) {
    return {
      repoUrl: 'https://github.com/whiparc/sample-app.git',
      destPath: '/var/www/app',
      branch: 'main',
      ansibleHost: '',
      ansibleUser: 'ubuntu'
    };
  }
  if (nodeId.startsWith('shell_command')) {
    return {
      command: 'echo "hello infrastructure"',
      chdir: '/tmp',
      ansibleHost: '',
      ansibleUser: 'ubuntu'
    };
  }
  if (nodeId.startsWith('file_copy')) {
    return {
      srcPath: 'config.json',
      destPath: '/var/www/app/config.json',
      owner: 'www-data',
      mode: '0644',
      ansibleHost: '',
      ansibleUser: 'ubuntu'
    };
  }
  if (nodeId.startsWith('open-port')) {
    return {
      port: '80',
      ansibleHost: '',
      ansibleUser: 'ubuntu'
    };
  }
  if (nodeId.startsWith('postgresql')) {
    return {
      dbUser: 'postgres',
      dbPass: 'postgres',
      ansibleHost: '',
      ansibleUser: 'ubuntu'
    };
  }
  if (nodeId.startsWith('deploy-node-app')) {
    return {
      startCommand: 'npm start',
      appPort: '3000',
      ansibleHost: '',
      ansibleUser: 'ubuntu'
    };
  }
  if (nodeId.startsWith('update-packages')) {
    return {
      ansibleHost: '',
      ansibleUser: 'ubuntu'
    };
  }
  if (nodeId.startsWith('nginx')) {
    return {
      ansibleHost: '',
      ansibleUser: 'ubuntu'
    };
  }
  if (nodeId.startsWith('nodejs')) {
    return {
      ansibleHost: '',
      ansibleUser: 'ubuntu'
    };
  }
  if (nodeId.startsWith('copy-env')) {
    return {
      ansibleHost: '',
      ansibleUser: 'ubuntu'
    };
  }
  // Kubernetes Nodes
  if (nodeId.startsWith('k8s_deployment')) {
    return {
      deploymentName: 'app-deploy',
      replicas: 3,
      imageName: 'nginx:1.21',
      containerPort: 80,
      cpuLimit: '500m',
      memoryLimit: '512Mi'
    };
  }
  if (nodeId.startsWith('k8s_service')) {
    return {
      serviceName: 'app-service',
      serviceType: 'ClusterIP',
      port: 80,
      targetPort: 80
    };
  }
  if (nodeId.startsWith('k8s_configmap')) {
    return {
      configMapName: 'app-config',
      dataKey: 'APP_ENV',
      dataValue: 'production'
    };
  }
  if (nodeId.startsWith('k8s_secret')) {
    return {
      secretName: 'app-secret',
      secretKey: 'DB_PASSWORD',
      secretValue: 'SecretString123'
    };
  }
  if (nodeId.startsWith('k8s_ingress')) {
    return {
      ingressName: 'app-ingress',
      host: 'app.local',
      path: '/',
      serviceName: 'app-service',
      servicePort: 80
    };
  }
  if (nodeId.startsWith('k8s_pvc')) {
    return {
      pvcName: 'app-pvc',
      storageSize: '10Gi',
      storageClass: 'standard'
    };
  }
  return {};
}

// --- MOCK LIBRARY DATA ---
const LIBRARY_NODES: LibraryNode[] = [
  {
    id: 'aws_target',
    tech: 'Target',
    icon: 'lucide:cloud',
    title: 'AWS Target',
    description: 'Chooses where this pipeline deploys — LocalStack sandbox for testing, real AWS later.',
    category: 'Cloud Target'
  },
  {
    id: 'gcp_target',
    tech: 'Target',
    icon: 'lucide:cloud',
    title: 'GCP Target',
    description: 'Chooses where this pipeline deploys — Live GCP Project.',
    category: 'Cloud Target'
  },
  // Terraform Nodes
  {
    id: 'aws_instance.web_server',
    tech: 'Terraform',
    icon: 'lucide:server',
    title: 'Virtual Machine (EC2)',
    description: 'Provisions a high-performance VM instance with security groups.',
    category: 'Provisioning & Cloud',
    outputs: ['public_ip', 'private_ip', 'id', 'ssh_user']
  },
  {
    id: 'aws_security_group',
    tech: 'Terraform',
    icon: 'lucide:shield',
    title: 'Firewall (Security Group)',
    description: 'Configures stateful firewall rules to allow traffic.',
    category: 'Provisioning & Cloud',
    outputs: ['sg_id', 'sg_name']
  },
  {
    id: 'aws_s3_bucket',
    tech: 'Terraform',
    icon: 'lucide:hard-drive',
    title: 'Object Storage (S3)',
    description: 'Provisions a secure cloud object storage bucket.',
    category: 'Provisioning & Cloud',
    outputs: ['bucket_name', 'bucket_arn']
  },
  {
    id: 'aws_db_instance',
    tech: 'Terraform',
    icon: 'lucide:database',
    title: 'Relational Database (RDS)',
    description: 'Deploys a PostgreSQL database instance.',
    category: 'Provisioning & Cloud',
    outputs: ['endpoint', 'port', 'db_name', 'username']
  },
  {
    id: 'aws_vpc',
    tech: 'Terraform',
    icon: 'lucide:network',
    title: 'Virtual Network (VPC)',
    description: 'Creates a custom virtual private cloud network.',
    category: 'Provisioning & Cloud',
    outputs: ['vpc_id', 'cidr_block']
  },
  {
    id: 'aws_subnet',
    tech: 'Terraform',
    icon: 'lucide:split',
    title: 'Network Subnet',
    description: 'Allocates a specific subnet in a VPC.',
    category: 'Provisioning & Cloud',
    outputs: ['subnet_id', 'availability_zone']
  },
  // Ansible Nodes
  {
    id: 'update-packages',
    tech: 'Ansible',
    icon: 'lucide:refresh-cw',
    title: 'Update Packages',
    description: 'Updates package repositories and upgrades system modules.',
    category: 'Configuration & Setup'
  },
  {
    id: 'nginx',
    tech: 'Ansible',
    icon: 'lucide:globe',
    title: 'Install Nginx',
    description: 'Installs and configures the latest stable Nginx web server.',
    category: 'Configuration & Setup'
  },
  {
    id: 'nodejs',
    tech: 'Ansible',
    icon: 'lucide:terminal',
    title: 'Install Node.js',
    description: 'Installs Node.js packages and npm environment.',
    category: 'Configuration & Setup'
  },
  {
    id: 'postgresql',
    tech: 'Ansible',
    icon: 'lucide:database',
    title: 'PostgreSQL Database',
    description: 'Installs PostgreSQL database and creates deployment schema.',
    category: 'Configuration & Setup'
  },
  {
    id: 'open-port',
    tech: 'Ansible',
    icon: 'lucide:unlock',
    title: 'Open Port',
    description: 'Opens a selected networking port in local host firewalls.',
    category: 'Configuration & Setup'
  },
  {
    id: 'copy-env',
    tech: 'Ansible',
    icon: 'lucide:file-text',
    title: 'Copy .env File',
    description: 'Synchronizes environment local configurations onto remote hosts.',
    category: 'Configuration & Setup'
  },
  {
    id: 'deploy-node-app',
    tech: 'Ansible',
    icon: 'lucide:rocket',
    title: 'Deploy Node App',
    description: 'Copies the connected repo onto the server, runs npm install, and starts it with pm2.',
    category: 'Configuration & Setup'
  },
  {
    id: 'apt_install',
    tech: 'Ansible',
    icon: 'lucide:package',
    title: 'Install Packages (Apt)',
    description: 'Installs custom system packages using Apt package manager.',
    category: 'Configuration & Setup'
  },
  {
    id: 'create_user',
    tech: 'Ansible',
    icon: 'lucide:user-plus',
    title: 'Create System User',
    description: 'Configures a new Linux user with system access.',
    category: 'Configuration & Setup'
  },
  {
    id: 'systemd_service',
    tech: 'Ansible',
    icon: 'lucide:settings',
    title: 'Systemd Service',
    description: 'Controls background daemon services (Start/Stop/Restart).',
    category: 'Configuration & Setup'
  },
  {
    id: 'git_clone',
    tech: 'Ansible',
    icon: 'lucide:git-pull-request',
    title: 'Git Clone',
    description: 'Clones repository codebases to a custom target directory.',
    category: 'Configuration & Setup'
  },
  {
    id: 'shell_command',
    tech: 'Ansible',
    icon: 'lucide:terminal',
    title: 'Run Command',
    description: 'Executes direct CLI shell commands on target hosts.',
    category: 'Configuration & Setup'
  },
  {
    id: 'file_copy',
    tech: 'Ansible',
    icon: 'lucide:copy',
    title: 'Copy File',
    description: 'Synchronizes specific files with target remote hosts.',
    category: 'Configuration & Setup'
  },
  // Kubernetes Nodes
  {
    id: 'k8s_deployment',
    tech: 'Kubernetes',
    icon: 'lucide:layers',
    title: 'Pod Deployment',
    description: 'Configures a scalable deployment with rolling updates and resource limits.',
    category: 'Container Deployment'
  },
  {
    id: 'k8s_service',
    tech: 'Kubernetes',
    icon: 'lucide:external-link',
    title: 'Service',
    description: 'Exposes pods to network traffic via LoadBalancer or ClusterIP.',
    category: 'Container Deployment'
  },
  {
    id: 'k8s_configmap',
    tech: 'Kubernetes',
    icon: 'lucide:file-code',
    title: 'ConfigMap',
    description: 'Binds non-sensitive key-value environment files to pods.',
    category: 'Container Deployment'
  },
  {
    id: 'k8s_secret',
    tech: 'Kubernetes',
    icon: 'lucide:key-round',
    title: 'Secret',
    description: 'Injects encrypted environment credentials into container contexts.',
    category: 'Container Deployment'
  },
  {
    id: 'k8s_ingress',
    tech: 'Kubernetes',
    icon: 'lucide:route',
    title: 'Ingress',
    description: 'Routes HTTP/HTTPS external traffic to K8s services.',
    category: 'Container Deployment'
  },
  {
    id: 'k8s_pvc',
    tech: 'Kubernetes',
    icon: 'lucide:database',
    title: 'PersistentVolumeClaim',
    description: 'Allocates persistent disk space for stateful pod workloads.',
    category: 'Container Deployment'
  }
];

// --- FLOW EDITOR AREA CANVAS ---
interface WorkspaceCanvasProps {
  deployStatus: string;
  planStatus: string;
  peerCursors: Record<string, { x: number; y: number; name: string; color: string }>;
  handleMouseMove: (e: React.MouseEvent) => void;
}

function WorkspaceCanvas({ deployStatus, planStatus, peerCursors = {}, handleMouseMove }: WorkspaceCanvasProps) {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    setSelectedNodeId,
    saveStatus,
    setSelectedEdgeId
  } = useCanvasStore();

  const { screenToFlowPosition } = useReactFlow();

  const isPipelineRunning = deployStatus === 'PENDING' || deployStatus === 'RUNNING' || planStatus === 'PENDING' || planStatus === 'RUNNING';
  const isReadOnly = isPipelineRunning || saveStatus === 'readonly';

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    if (isReadOnly) {
      const filtered = changes.filter(c => c.type !== 'remove');
      onNodesChange(filtered);
    } else {
      onNodesChange(changes);
    }
  }, [onNodesChange, isReadOnly]);

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (isReadOnly) {
      const filtered = changes.filter(c => c.type !== 'remove');
      onEdgesChange(filtered);
    } else {
      onEdgesChange(changes);
    }
  }, [onEdgesChange, isReadOnly]);

  const handleConnect = useCallback((params: Connection) => {
    if (isReadOnly) return;
    onConnect(params);
  }, [onConnect, isReadOnly]);

  const nodeTypes = useMemo(() => ({ customNode: ReactFlowCanvasNode }), []);
  const edgeTypes = useMemo(() => ({ default: BlueprintEdge }), []);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();

    if (isPipelineRunning) {
      alert("⚠️ Canvas is locked: Cannot drop nodes while a pipeline execution is running.");
      return;
    }

    const id = event.dataTransfer.getData('application/reactflow-node-id');
    if (!id) return;

    const tech = event.dataTransfer.getData('application/reactflow-node-tech');
    const icon = event.dataTransfer.getData('application/reactflow-node-icon');
    const title = event.dataTransfer.getData('application/reactflow-node-title');
    const description = event.dataTransfer.getData('application/reactflow-node-description');
    const category = event.dataTransfer.getData('application/reactflow-node-category');

    const position = screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });

    const newNodeId = `${id}_${Date.now().toString().slice(-4)}`;

    const isCustom = event.dataTransfer.getData('application/reactflow-node-iscustom') === 'true';
    const rawCode = event.dataTransfer.getData('application/reactflow-node-rawcode');
    const codeType = event.dataTransfer.getData('application/reactflow-node-codetype');
    const parametersStr = event.dataTransfer.getData('application/reactflow-node-parameters');

    const defaultParams = getDefaultParametersForNode(id);
    let parsedParameters = defaultParams;
    if (isCustom && parametersStr) {
      try {
        parsedParameters = JSON.parse(parametersStr);
      } catch {}
    }

    const newNode: Node = {
      id: newNodeId,
      type: 'customNode',
      position,
      data: {
        label: title,
        tech: tech as LibraryNode['tech'],
        icon,
        categoryLabel: category || (tech === 'Terraform' ? 'AWS Resource' : tech === 'Ansible' ? 'Ansible Task' : tech === 'Source' ? 'Source Code' : tech === 'Target' ? 'Cloud Target' : 'K8s Resource'),
        description,
        status: 'Validated',
        statusText: isCustom ? 'Custom Block' : 'Validated',
        parameters: parsedParameters,
        isCustom: isCustom ? true : undefined,
        rawCode: isCustom ? rawCode : undefined,
        codeType: isCustom ? (codeType as LibraryNode['codeType']) : undefined,
        port: parsedParameters?.port,
        dbUser: parsedParameters?.dbUser,
        dbPass: parsedParameters?.dbPass,
        repoUrl: parsedParameters?.repoUrl,
        branch: parsedParameters?.branch,
        startCommand: parsedParameters?.startCommand,
        appPort: parsedParameters?.appPort,
      },
    };

    if (!isCustom) {
      if (id === 'aws_instance.web_server') {
        newNode.data.parameters = { ...DEFAULT_INSTANCE_PARAMS };
      }
      if (id === 'aws_security_group') {
        newNode.data.parameters = { ...DEFAULT_SG_PARAMS };
      }
    }

    addNode(newNode);
    setSelectedNodeId(newNodeId);
  }, [screenToFlowPosition, addNode, setSelectedNodeId, isPipelineRunning]);

  return (
    <div
      className="flex-grow h-full relative overflow-hidden"
      onDragOver={onDragOver}
      onDrop={onDrop}
      onMouseMove={handleMouseMove}
    >
      {/* Floating Peer Cursors Overlay */}
      {Object.entries(peerCursors).map(([id, cursor]) => (
        <div
          key={id}
          className="absolute pointer-events-none z-50 transition-all duration-75 ease-out"
          style={{ left: cursor.x, top: cursor.y }}
        >
          <Icon 
            icon="lucide:mouse-pointer-2" 
            className="text-lg rotate-[270deg]" 
            style={{ color: cursor.color }} 
          />
          <div 
            className="absolute left-4 top-4 rounded px-2 py-0.5 text-[10px] font-bold text-white whitespace-nowrap shadow-md select-none"
            style={{ backgroundColor: cursor.color }}
          >
            {cursor.name}
          </div>
        </div>
      ))}
      <ReactFlow
        proOptions={{ hideAttribution: true }}
        nodes={nodes}
        edges={edges}
        connectionLineType={ConnectionLineType.Step}
        connectionLineStyle={{ stroke: 'var(--accent-ink)', strokeWidth: 1.5, strokeDasharray: '5 4' }}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={(_, node) => {
          setSelectedEdgeId(null);
          setSelectedNodeId(node.id);
        }}
        onEdgeClick={(_, edge) => {
          setSelectedNodeId(null);
          setSelectedEdgeId(edge.id);
        }}
        onPaneClick={() => {
          setSelectedNodeId(null);
          setSelectedEdgeId(null);
        }}
        fitView
        nodesDraggable={!isReadOnly}
        nodesConnectable={!isReadOnly}
        elementsSelectable={!isReadOnly}
        panOnDrag
        deleteKeyCode={isReadOnly ? null : ['Backspace', 'Delete']}
      >
        <Background variant={BackgroundVariant.Lines} gap={28} lineWidth={1} color="var(--line)" />
        <Controls showInteractive={false} />
      </ReactFlow>

      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 select-none animate-in fade-in duration-300">
          <div style={{ textAlign: 'center' }}>
            <Icon icon="lucide:layers" width={22} height={22} style={{ color: 'var(--ink3)' }} />
            <p style={{ margin: '10px 0 0', fontFamily: 'var(--font-display, inherit)', fontWeight: 600, fontSize: 14, color: 'var(--ink2)' }}>
              Your canvas is empty
            </p>
            <p style={{ margin: '4px 0 0', fontFamily: 'var(--font-body-marketing, inherit)', fontSize: 12, color: 'var(--ink3)' }}>
              Drag a node from the library to get started.
            </p>
          </div>
        </div>
      )}

    </div>
  );
}

// --- WORKSPACE LAYOUT WRAPPER ---
function WorkspaceContent() {
  const router = useRouter();
  const { 
    nodes, 
    edges, 
    selectedNodeId, 
    updateNodeData, 
    resetCanvas,
    setSelectedNodeId,
    saveStatus,
    setSaveStatus,
    version,
    setVersion,
    setNodes,
    setEdges,
    setCustomLibraryNodes,
    setProjectId,
    selectedEdgeId,
    updateEdgeData,
    deleteEdge
  } = useCanvasStore();
  const { setViewport, getZoom } = useReactFlow();

  const searchParams = useSearchParams();
  const hasProjectParam = !!searchParams.get('project');
  const projectId = searchParams.get('project') || 'Web-Server-Orchestration';
  const selectedProject = projectId; // compatibility alias

  // Bare /workspace with no project selected is a dead end (all real workspaces
  // are opened via /workspace?project=<id>) — send the user to create one instead.
  useEffect(() => {
    if (!hasProjectParam) {
      router.replace('/dashboard?create=1');
    }
  }, [hasProjectParam, router]);

  const { token, user, hasHydrated } = useAuthStore();

  const syncWsRef = useRef<WebSocket | null>(null);
  const isIncomingSyncRef = useRef<boolean>(false);
  const lastStateRef = useRef<{ nodes: Node[], edges: Edge[] }>({ nodes: [], edges: [] });

  const [collaborators, setCollaborators] = useState<{ id: string; name: string; color: string }[]>([]);
  const [isSyncConnected, setIsSyncConnected] = useState(false);
  const [peerCursors, setPeerCursors] = useState<Record<string, { x: number; y: number; name: string; color: string }>>({});
  const [, setPeerEdits] = useState<Record<string, string>>({}); // maps nodeId -> userName editing it
  const [projectDetails, setProjectDetails] = useState<Project | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCustomNodeOpen, setIsCustomNodeOpen] = useState(false);
  const [availableCredentials, setAvailableCredentials] = useState<Credential[]>([]);
  const [agentStatus, setAgentStatus] = useState<string | null>(null);
  const [migrationStatus, setMigrationStatus] = useState<{ gated: boolean; has_active_agent: boolean; grace_period_end: string } | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [techFilter, setTechFilter] = useState("All");
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [theme, setTheme] = useState<Theme>('dark');
  const [activeView, setActiveView] = useState<WorkspaceView>('canvas');

  const [deployStatus, setDeployStatus] = useState<"IDLE" | "PENDING" | "RUNNING" | "CLEANUP" | "SUCCESS" | "FAILED">("IDLE");
  // Separate from deployStatus, deliberately: a plan is a read-only dry run,
  // not a deploy/destroy, and other code keys off deployStatus reaching
  // SUCCESS/FAILED to mean "resources are now live/gone" — conflating the
  // two would make a mere preview look like it deployed or tore down
  // something. Each of handleDeployClick/handlePlanClick/handleDestroyClick
  // resets the *other* machine to IDLE on start, so at most one is ever
  // non-IDLE at a time (see planOrDeployStatus below).
  const [planStatus, setPlanStatus] = useState<"IDLE" | "PENDING" | "RUNNING" | "SUCCESS" | "FAILED">("IDLE");
  const [logs, setLogs] = useState("");
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [, setActiveRunId] = useState<string | null>(null);
  const [autoDestroy, setAutoDestroy] = useState(true);
  const isPipelineBusy = deployStatus === 'PENDING' || deployStatus === 'RUNNING' || planStatus === 'PENDING' || planStatus === 'RUNNING';

  const wsRef = useRef<WebSocket | null>(null);
  const terminalEndRef = useRef<HTMLDivElement | null>(null);

  // Authenticate session and protect workspace routes
  useEffect(() => {
    if (hasHydrated && !token) {
      router.push('/login');
    }
  }, [hasHydrated, token, router]);

  // Connect to WebSocket Room Syncing
  useEffect(() => {
    const activeToken = token;
    if (!activeToken || !projectId || !user) return;

    const apiHost = process.env.NEXT_PUBLIC_API_URL 
      ? process.env.NEXT_PUBLIC_API_URL.replace(/^http/, 'ws') 
      : 'ws://localhost:8080';
    const wsUrl = `${apiHost}/api/workspace/${projectId}/sync?token=${activeToken}`;

    const ws = new WebSocket(wsUrl);
    syncWsRef.current = ws;

    ws.onopen = () => {
      setIsSyncConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const { type, senderId, senderName, color, payload } = msg;

        if (type === 'init' || type === 'join' || type === 'leave') {
          const members = payload ? JSON.parse(JSON.stringify(payload)) : [];
          if (Array.isArray(members)) {
            const activePeers = members.filter(m => m.id !== user.id);
            // Deduplicate by user ID to show each peer only once
            const uniquePeers = activePeers.filter((value, index, self) =>
              self.findIndex(m => m.id === value.id) === index
            );
            setCollaborators(uniquePeers);
          }
          if (type === 'leave') {
            setPeerCursors(prev => {
              const copy = { ...prev };
              delete copy[senderId];
              return copy;
            });
          }

          if (type === 'init' && Array.isArray(members)) {
            const activePeers = members.filter(m => m.id !== user.id);
            if (activePeers.length > 0) {
              ws.send(JSON.stringify({ type: 'request_sync' }));
            }
          }
        } else if (type === 'request_sync') {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'change',
              payload: {
                nodes: useCanvasStore.getState().nodes,
                edges: useCanvasStore.getState().edges
              }
            }));
          }
        } else if (type === 'cursor') {
          setPeerCursors(prev => ({
            ...prev,
            [senderId]: { x: payload.x, y: payload.y, name: senderName, color }
          }));
        } else if (type === 'edit') {
          const { nodeId, isEditing } = payload;
          setPeerEdits(prev => {
            const copy = { ...prev };
            if (isEditing) {
              copy[nodeId] = senderName;
            } else {
              delete copy[nodeId];
            }
            return copy;
          });
        } else if (type === 'change') {
          const { nodes: peerNodes, edges: peerEdges } = payload;
          isIncomingSyncRef.current = true;
          if (peerNodes) useCanvasStore.getState().setNodes(peerNodes);
          if (peerEdges) useCanvasStore.getState().setEdges(peerEdges);
        }
      } catch (err) {
        console.warn('Error handling WebSocket sync message', err);
      }
    };

    ws.onclose = () => {
      setIsSyncConnected(false);
      setCollaborators([]);
      setPeerCursors({});
    };

    return () => {
      ws.close();
    };
  }, [projectId, user, token]);

  // Load Project Details & Canvas State on mount
  useEffect(() => {
    const activeToken = token;
    if (!activeToken || !projectId || !user) return;

    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

    const loadProjectAndCanvas = async () => {
      try {
        // 1. Get project details and role
        const projRes = await fetch(`${API_URL}/api/projects/${projectId}`, {
          headers: { 'Authorization': `Bearer ${activeToken}` }
        });
        if (!projRes.ok) {
          setSaveStatus('readonly');
          return;
        }
        const projDetails = await projRes.json();
        setProjectDetails(projDetails);
        if (projDetails.user_role === 'VIEWER') {
          setSaveStatus('readonly');
        } else {
          setSaveStatus('saved');
        }

        // 2. Fetch canvas state
        const canvasRes = await fetch(`${API_URL}/api/projects/${projectId}/canvas`, {
          headers: { 'Authorization': `Bearer ${activeToken}` }
        });
        if (canvasRes.ok) {
          const state = await canvasRes.json();
          
          isIncomingSyncRef.current = true;
          const parsedNodes = JSON.parse(state.nodes_json || '[]');
          const parsedEdges = JSON.parse(state.edges_json || '[]');
          
          setNodes(parsedNodes);
          setEdges(parsedEdges);
          setVersion(state.version || 1);
          setProjectId(projectId);

          // Restore viewport
          const viewport = JSON.parse(state.viewport_json || '{"x":0,"y":0,"zoom":1}');
          setViewport({ x: viewport.x || 0, y: viewport.y || 0, zoom: viewport.zoom || 1 }, { duration: 400 });
        }

        // 3. Fetch custom nodes templates
        const customRes = await fetch(`${API_URL}/api/projects/${projectId}/custom-nodes`, {
          headers: { 'Authorization': `Bearer ${activeToken}` }
        });
        if (customRes.ok) {
          const customNodes = await customRes.json();
          setCustomLibraryNodes(customNodes || []);
        }

        // 4. Fetch cloud credentials
        const credsRes = await fetch(`${API_URL}/api/projects/${projectId}/credentials`, {
          headers: { 'Authorization': `Bearer ${activeToken}` }
        });
        if (credsRes.ok) {
          const creds = await credsRes.json();
          setAvailableCredentials(creds || []);
        }
      } catch (err) {
        console.warn("Failed to load project canvas data", err);
      }
    };

    loadProjectAndCanvas();
  }, [projectId, user, setViewport, setNodes, setEdges, setVersion, setSaveStatus, setCustomLibraryNodes, setProjectId, token]);

  // Poll the paired Sandbox Agent's connection status (see
  // obsidian_memory/08.4's Phase 2 heartbeat/daemon-install entries) so a
  // disconnected agent is visible in the header instead of only discovered
  // via a failed deploy. Polling, not a WebSocket push: the underlying
  // disconnect detection itself already has a ~30-40s natural delay (yamux's
  // keepalive), so a live push wouldn't buy more responsiveness than an
  // interval this size. 404 (route not registered when the beta flag is off,
  // or no agent ever paired for this project) means "hide the badge," not an
  // error; any other failure leaves the previous value alone rather than
  // flickering the badge away on a transient network blip.
  useEffect(() => {
    const activeToken = token;
    if (!activeToken || !projectId || !user) return;

    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
    let cancelled = false;

    const pollAgentStatus = async () => {
      try {
        const res = await fetch(`${API_URL}/api/projects/${projectId}/agents/latest`, {
          headers: { 'Authorization': `Bearer ${activeToken}` }
        });
        if (cancelled) return;
        if (res.status === 404) {
          setAgentStatus(null);
          return;
        }
        if (!res.ok) return;
        const data = await res.json();
        setAgentStatus(data.status ?? null);
      } catch (err) {
        // Transient network error — leave the previous badge state as-is.
        console.log("Agent status poll error", err);
      }
    };

    pollAgentStatus();
    const intervalId = setInterval(pollAgentStatus, 15000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [projectId, user, token]);

  // Polls Phase 3's default-flip migration status (obsidian_memory/08.4) so a
  // FREE-plan user sees the "pair an agent or upgrade" notice before a deploy
  // ever gets rejected for it. 404 means "nothing to show" — not on the FREE
  // plan, or the default-flip isn't configured on this deployment at all —
  // same badge-hiding convention as the agent-status poll above.
  useEffect(() => {
    const activeToken = token;
    if (!activeToken || !projectId || !user) return;

    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
    let cancelled = false;

    const pollMigrationStatus = async () => {
      try {
        const res = await fetch(`${API_URL}/api/projects/${projectId}/sandbox-migration-status`, {
          headers: { 'Authorization': `Bearer ${activeToken}` }
        });
        if (cancelled) return;
        if (res.status === 404) {
          setMigrationStatus(null);
          return;
        }
        if (!res.ok) return;
        setMigrationStatus(await res.json());
      } catch (err) {
        // Transient network error — leave the previous badge state as-is.
        console.log("Migration status poll error", err);
      }
    };

    pollMigrationStatus();
    const intervalId = setInterval(pollMigrationStatus, 15000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [projectId, user, token]);

  // Broadcast local canvas state changes to room peers AND auto-save debouncely to REST API
  useEffect(() => {
    if (isIncomingSyncRef.current) {
      isIncomingSyncRef.current = false;
      lastStateRef.current = { nodes, edges };
      return;
    }

    if (JSON.stringify(nodes) === JSON.stringify(lastStateRef.current.nodes) &&
        JSON.stringify(edges) === JSON.stringify(lastStateRef.current.edges)) {
      return;
    }

    // 1. Broadcast real-time sync event to peers
    if (syncWsRef.current && syncWsRef.current.readyState === WebSocket.OPEN) {
      syncWsRef.current.send(JSON.stringify({
        type: 'change',
        payload: { nodes, edges }
      }));
    }

    lastStateRef.current = { nodes, edges };

    // 2. Debounced Database Auto-Save
    if (saveStatus === 'readonly') return;

    setSaveStatus('saving');
    const timer = setTimeout(async () => {
      const activeToken = token;
      if (!activeToken || !projectId) return;

      try {
        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
        
        // Fetch current zoom/pan coordinates for the viewport JSON
        const zoom = getZoom();
        const pane = document.querySelector('.react-flow__renderer') as HTMLElement;
        const transform = pane?.style.transform || '';
        const match = transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
        const x = match ? parseFloat(match[1]) : 0;
        const y = match ? parseFloat(match[2]) : 0;

        const res = await fetch(`${API_URL}/api/projects/${projectId}/canvas`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${activeToken}`
          },
          body: JSON.stringify({
            nodes_json: JSON.stringify(nodes),
            edges_json: JSON.stringify(edges),
            viewport_json: JSON.stringify({ x, y, zoom }),
            version: version
          })
        });

        if (res.ok) {
          const result = await res.json();
          setVersion(result.version);
          setSaveStatus('saved');
        } else if (res.status === 409) {
          setSaveStatus('error');
          console.warn("Version mismatch conflict on auto-save.");
        } else {
          setSaveStatus('error');
        }
      } catch (err) {
        console.warn("Auto-save call error", err);
        setSaveStatus('error');
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, [nodes, edges, projectId, version, saveStatus, getZoom, setSaveStatus, setVersion, token]);

  // Track cursor positions on mousemove (throttled)
  const lastCursorTimeRef = useRef<number>(0);
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!syncWsRef.current || syncWsRef.current.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    if (now - lastCursorTimeRef.current < 60) return; // 60ms throttle
    lastCursorTimeRef.current = now;

    const container = document.querySelector('.react-flow__pane');
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    syncWsRef.current.send(JSON.stringify({
      type: 'cursor',
      payload: { x, y }
    }));
  }, []);

  const handleStartEditing = useCallback((nodeId: string) => {
    if (syncWsRef.current && syncWsRef.current.readyState === WebSocket.OPEN) {
      syncWsRef.current.send(JSON.stringify({
        type: 'edit',
        payload: { nodeId, isEditing: true }
      }));
    }
  }, []);

  const handleEndEditing = useCallback((nodeId: string) => {
    if (syncWsRef.current && syncWsRef.current.readyState === WebSocket.OPEN) {
      syncWsRef.current.send(JSON.stringify({
        type: 'edit',
        payload: { nodeId, isEditing: false }
      }));
    }
  }, []);

  // Auto-scroll terminal when logs change
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // Clean up websocket connection on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // Sync execution status to the canvas store
  useEffect(() => {
    const isExecuting = deployStatus === 'PENDING' || deployStatus === 'RUNNING' || planStatus === 'PENDING' || planStatus === 'RUNNING';
    useCanvasStore.getState().setIsExecuting(isExecuting);
  }, [deployStatus, planStatus]);

  const handleDeployClick = async () => {
    if (nodes.length === 0) {
      alert("⚠️ Cannot deploy: Canvas is empty.");
      return;
    }

    setDeployStatus("PENDING");
    setPlanStatus("IDLE");
    setLogs("[CLIENT] Compiling canvas files and preparing payload...\n");
    setIsTerminalOpen(true);
    setActiveRunId(null);
    useCanvasStore.getState().resetExecutionStatuses();
    useCanvasStore.getState().setPipelineAction('deploy');

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    try {
      // Compile files on the client side (Approach A)
      const compiledFiles = generateBundleFiles(nodes, edges);

      // Make post request to Go backend
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
      const activeToken = token;
      const response = await fetch(`${API_URL}/api/projects/${projectId}/deploy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${activeToken}`
        },
        body: JSON.stringify({
          canvas: { nodes, edges },
          files: compiledFiles.map(f => ({ path: f.path, content: f.content })),
          autoDestroy: autoDestroy
        })
      });

      if (!response.ok) {
        // handleDeploy rejects with a plain-text reason (missing SSH credential,
        // unpaired local agent, free-tier gate, ...); surface it instead of a bare status.
        const detail = (await response.text().catch(() => '')).trim();
        throw new Error(`Failed to deploy. HTTP status: ${response.status}${detail ? ` - ${detail}` : ''}`);
      }

      const data = await response.json();
      const runId = data.runId;
      setActiveRunId(runId);
      setDeployStatus(data.status);
      setLogs(prev => prev + `[CLIENT] Deployment registered with runID: ${runId}\n[CLIENT] Establishing log streaming WebSocket connection...\n`);

      // Connect to WebSocket endpoint
      const apiHost = process.env.NEXT_PUBLIC_API_URL
        ? process.env.NEXT_PUBLIC_API_URL.replace(/^http/, 'ws')
        : 'ws://localhost:8080';
      const wsUrl = `${apiHost}/api/ws/runs/${runId}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setLogs(prev => prev + "[CLIENT] WebSocket connection established. Streaming pipeline runner logs...\n");
      };

      ws.onmessage = (event) => {
        try {
          const wsData = JSON.parse(event.data);
          if (wsData.type === "status_change") {
            setDeployStatus(wsData.status);
          } else if (wsData.type === "log") {
            setLogs(prev => prev + wsData.message);
          } else if (wsData.type === "node_status") {
            useCanvasStore.getState().setNodeExecutionStatus(wsData.nodeId, wsData.status);
          }
        } catch (e) {
          // Fallback if message is raw text
          setLogs(prev => prev + event.data + '\n' + e);
        }
      };

      ws.onerror = (err) => {
        setLogs(prev => prev + `\n[CLIENT] WebSocket encountered an error.\n`);
        console.warn("WS error:", err);
      };

      ws.onclose = (event) => {
        setLogs(prev => prev + `\n[CLIENT] Log stream closed (code: ${event.code}).\n`);
      };

    } catch (err: unknown) {
      setDeployStatus("FAILED");
      const errMessage = err instanceof Error ? err.message : String(err);
      setLogs(prev => prev + `\n[CLIENT_ERROR] Failed to execute deployment: ${errMessage}\n`);
    }
  };

  // A real `terraform plan` dry run (product-memory 08.5 item A9) — mirrors
  // handleDeployClick's shape (same compile-and-POST-then-stream-over-WS
  // flow, since log streaming is action-agnostic server-side) but posts to
  // /plan and tracks planStatus instead of deployStatus, so this never
  // reads as "deployed" to any code keying off deployStatus.
  const handlePlanClick = async () => {
    if (nodes.length === 0) {
      alert("⚠️ Cannot plan: Canvas is empty.");
      return;
    }

    setPlanStatus("PENDING");
    setDeployStatus("IDLE");
    setLogs("[CLIENT] Compiling canvas files and preparing payload for plan...\n");
    setIsTerminalOpen(true);
    setActiveRunId(null);

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    try {
      const compiledFiles = generateBundleFiles(nodes, edges);

      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
      const activeToken = token;
      const response = await fetch(`${API_URL}/api/projects/${projectId}/plan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${activeToken}`
        },
        body: JSON.stringify({
          canvas: { nodes, edges },
          files: compiledFiles.map(f => ({ path: f.path, content: f.content }))
        })
      });

      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).trim();
        throw new Error(`Failed to plan. HTTP status: ${response.status}${detail ? ` - ${detail}` : ''}`);
      }

      const data = await response.json();
      const runId = data.runId;
      setActiveRunId(runId);
      setPlanStatus(data.status);
      setLogs(prev => prev + `[CLIENT] Plan registered with runID: ${runId}\n[CLIENT] Establishing log streaming WebSocket connection...\n`);

      const apiHost = process.env.NEXT_PUBLIC_API_URL
        ? process.env.NEXT_PUBLIC_API_URL.replace(/^http/, 'ws')
        : 'ws://localhost:8080';
      const wsUrl = `${apiHost}/api/ws/runs/${runId}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setLogs(prev => prev + "[CLIENT] WebSocket connection established. Streaming pipeline runner logs...\n");
      };

      ws.onmessage = (event) => {
        try {
          const wsData = JSON.parse(event.data);
          if (wsData.type === "status_change") {
            setPlanStatus(wsData.status);
          } else if (wsData.type === "log") {
            setLogs(prev => prev + wsData.message);
          }
          // No node_status handling: RunPipeline's plan branch never emits
          // one (see its comment — a node isn't "completed" just because a
          // plan mentioned it).
        } catch (e) {
          setLogs(prev => prev + event.data + '\n' + e);
        }
      };

      ws.onerror = (err) => {
        setLogs(prev => prev + `\n[CLIENT] WebSocket encountered an error.\n`);
        console.warn("WS error:", err);
      };

      ws.onclose = (event) => {
        setLogs(prev => prev + `\n[CLIENT] Log stream closed (code: ${event.code}).\n`);
      };

    } catch (err: unknown) {
      setPlanStatus("FAILED");
      const errMessage = err instanceof Error ? err.message : String(err);
      setLogs(prev => prev + `\n[CLIENT_ERROR] Failed to execute plan: ${errMessage}\n`);
    }
  };

  const handleDestroyClick = async () => {
    setDeployStatus("PENDING");
    setPlanStatus("IDLE");
    setLogs("[CLIENT] Triggering infrastructure tear-down (terraform destroy)...\n");
    setIsTerminalOpen(true);
    setActiveRunId(null);
    useCanvasStore.getState().resetExecutionStatuses();
    useCanvasStore.getState().setPipelineAction('destroy');

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    try {
      // Make destroy request to Go backend
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
      const activeToken = token;
      const response = await fetch(`${API_URL}/api/projects/${projectId}/destroy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${activeToken}`
        },
        body: JSON.stringify({
          canvas: { nodes, edges }
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to trigger destroy. HTTP status: ${response.status}`);
      }

      const data = await response.json();
      const runId = data.runId;
      setActiveRunId(runId);
      setDeployStatus(data.status);
      setLogs(prev => prev + `[CLIENT] Destroy run registered with runID: ${runId}\n[CLIENT] Establishing log streaming WebSocket connection...\n`);

      // Connect to WebSocket endpoint
      const apiHost = process.env.NEXT_PUBLIC_API_URL
        ? process.env.NEXT_PUBLIC_API_URL.replace(/^http/, 'ws')
        : 'ws://localhost:8080';
      const wsUrl = `${apiHost}/api/ws/runs/${runId}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setLogs(prev => prev + "[CLIENT] WebSocket connection established. Streaming execution logs...\n");
      };

      ws.onmessage = (event) => {
        try {
          const wsData = JSON.parse(event.data);
          if (wsData.type === "status_change") {
            setDeployStatus(wsData.status);
          } else if (wsData.type === "log") {
            setLogs(prev => prev + wsData.message);
          } else if (wsData.type === "node_status") {
            useCanvasStore.getState().setNodeExecutionStatus(wsData.nodeId, wsData.status);
          }
        } catch (e) {
          setLogs(prev => prev + event.data + '\n' + e);
        }
      };

      ws.onerror = (err) => {
        setLogs(prev => prev + `\n[CLIENT] WebSocket encountered an error.\n`);
        console.warn("WS error:", err);
      };

      ws.onclose = (event) => {
        setLogs(prev => prev + `\n[CLIENT] Log stream closed (code: ${event.code}).\n`);
      };

    } catch (err: unknown) {
      setDeployStatus("FAILED");
      const errMessage = err instanceof Error ? err.message : String(err);
      setLogs(prev => prev + `\n[CLIENT_ERROR] Failed to execute destroy: ${errMessage}\n`);
    }
  };

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
  };

  const handleTechFilterSelect = (tech: string) => {
    setTechFilter(tech);
  };

  const toggleRightPanel = () => {
    setRightPanelCollapsed(!rightPanelCollapsed);
  };

  const handleAddNodeToCanvas = (libNode: LibraryNode) => {
    if (isPipelineBusy) {
      alert("⚠️ Canvas is locked: Cannot add nodes while a pipeline execution is running.");
      return;
    }
    const newId = `${libNode.id}_${Date.now().toString().slice(-4)}`;
    
    // Position formula to avoid complete overlap
    const position = {
      x: 350 + (nodes.length * 30) % 250,
      y: 150 + (nodes.length * 30) % 250,
    };

    const newNode: Node = {
      id: newId,
      type: 'customNode',
      position,
      data: {
        label: libNode.title,
        tech: libNode.tech,
        icon: libNode.icon,
        categoryLabel: libNode.tech === 'Terraform' ? 'AWS Resource' : libNode.tech === 'Ansible' ? 'Ansible Task' : libNode.tech === 'Source' ? 'Source Code' : libNode.tech === 'Target' ? 'Cloud Target' : 'K8s Resource',
        description: libNode.description,
        status: 'Validated',
        statusText: 'Validated',
      },
    };

    const defaultParams = getDefaultParametersForNode(libNode.id);
    if (defaultParams) {
      newNode.data.parameters = defaultParams;
      // Sync direct property bounds for compatibility
      newNode.data.port = defaultParams.port;
      newNode.data.dbUser = defaultParams.dbUser;
      newNode.data.dbPass = defaultParams.dbPass;
      newNode.data.repoUrl = defaultParams.repoUrl;
      newNode.data.branch = defaultParams.branch;
      newNode.data.startCommand = defaultParams.startCommand;
      newNode.data.appPort = defaultParams.appPort;
    }

    // Call store action
    useCanvasStore.getState().addNode(newNode);
    useCanvasStore.getState().setSelectedNodeId(newId);
  };

  // Compile playbook YAML from current canvas nodes
  const ansiblePlaybook = useMemo(() => generateAnsibleYAML(nodes, edges), [nodes, edges]);

  // Navigate to export-code page
  const handleExportClick = () => {
    router.push(`/export-code?project=${projectId}`);
  };

  const handleClearCanvas = () => {
    if (isPipelineBusy) {
      alert("⚠️ Canvas is locked: Cannot clear the canvas while a pipeline execution is running.");
      return;
    }
    if (confirm('Delete every node and connection on this canvas? This cannot be undone.')) {
      resetCanvas();
    }
  };

  // Handle specific format downloads
  const handleExportFormat = async (format: string) => {
    if (format === 'zip') {
      await downloadZipBundle(nodes, edges);
    } else if (format === 'yml') {
      const blob = new Blob([ansiblePlaybook], { type: 'text/yaml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'playbook.yml';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } else if (format === 'tf') {
      await downloadTerraformZip(nodes, edges);
    } else if (format === 'json') {
      const k8sContent = {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "web-server" }
      };
      const blob = new Blob([JSON.stringify(k8sContent, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'deployment.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const selectedNode = useMemo(() => {
    return nodes.find(n => n.id === selectedNodeId) || null;
  }, [nodes, selectedNodeId]);

  const selectedEdge = useMemo(() => {
    return edges.find(e => e.id === selectedEdgeId) || null;
  }, [edges, selectedEdgeId]);

  if (!hasProjectParam) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background text-muted-foreground">
        <Icon icon="lucide:loader-2" className="animate-spin text-2xl" />
      </div>
    );
  }

  const themePalette = THEME_PALETTES[theme];
  const rootThemeStyle: React.CSSProperties = {
    ...(themePalette as unknown as React.CSSProperties),
    background: themePalette['--ground'],
    color: themePalette['--ink'],
  };

  return (
    <div
      className={`flex-1 flex flex-col overflow-hidden relative wp-root ${spaceGroteskFont.variable} ${barlowFont.variable} ${jetBrainsMonoFont.variable}`}
      style={{ ...rootThemeStyle, fontFamily: 'var(--font-body-marketing, inherit)', transition: 'background .3s ease, color .3s ease' }}
    >
      <WorkspaceHeaderV2
        selectedProject={selectedProject}
        projectDetails={projectDetails}
        activeView={activeView}
        onViewChange={setActiveView}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
        onExport={handleExportClick}
        onExportFormat={handleExportFormat}
        onDeploy={handleDeployClick}
        deployStatus={deployStatus}
        onPlan={handlePlanClick}
        planStatus={planStatus}
        autoDestroy={autoDestroy}
        onAutoDestroyChange={setAutoDestroy}
        onDestroy={handleDestroyClick}
        onClearCanvas={handleClearCanvas}
        collaborators={collaborators}
        isSyncConnected={isSyncConnected}
        saveStatus={saveStatus}
        onOpenSettings={() => setIsSettingsOpen(true)}
        agentStatus={agentStatus}
        migrationStatus={migrationStatus}
      />

      <EmailVerificationBanner />

      {activeView === 'canvas' && (
        <div className="flex-1 flex overflow-hidden relative">
          <LibraryPanelV2
            searchQuery={searchQuery}
            onSearchChange={handleSearchChange}
            techFilter={techFilter}
            onTechFilterSelect={handleTechFilterSelect}
            libraryNodes={LIBRARY_NODES}
            onAddNode={handleAddNodeToCanvas}
            isReadOnly={isPipelineBusy || saveStatus === 'readonly'}
            onCreateCustomNode={() => setIsCustomNodeOpen(true)}
          />

          <main className="flex-1 relative overflow-hidden flex flex-col" style={{ background: 'var(--ground)' }}>
            <WorkspaceCanvas
              deployStatus={deployStatus}
              planStatus={planStatus}
              peerCursors={peerCursors}
              handleMouseMove={handleMouseMove}
            />

            <div
              style={{
                position: 'absolute',
                top: 14,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 20,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                border: '1px solid var(--line)',
                background: 'var(--panel)',
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  background: agentStatus === 'ACTIVE' ? 'var(--accent-ink)' : agentStatus === 'PENDING' ? 'var(--amber)' : 'var(--ink3)',
                  animation: agentStatus === 'ACTIVE' ? 'wpBeat 2.2s ease-in-out infinite' : undefined,
                }}
              />
              <span style={{ fontFamily: 'var(--font-mono-marketing, monospace)', fontSize: 10.5, color: 'var(--ink2)' }}>
                {agentStatus === 'ACTIVE' ? 'sandbox online · local_agent' : agentStatus === 'PENDING' ? 'sandbox pairing…' : 'sandbox offline'}
              </span>
            </div>
          </main>

          <InspectorPanel
            collapsed={rightPanelCollapsed}
            onToggle={toggleRightPanel}
            selectedNode={selectedNode}
            selectedEdge={selectedEdge}
            updateNodeData={updateNodeData}
            updateEdgeData={updateEdgeData}
            deleteEdge={deleteEdge}
            nodes={nodes}
            setSelectedNodeId={setSelectedNodeId}
            isReadOnly={isPipelineBusy || saveStatus === 'readonly'}
            onStartEditing={handleStartEditing}
            onEndEditing={handleEndEditing}
            availableCredentials={availableCredentials}
          />
        </div>
      )}

      {activeView === 'variables' && (
        <div className="wp-legacy-token-scope flex-1 overflow-hidden" style={{ ...LEGACY_TOKEN_SCOPE_STYLE, background: 'var(--ground)' }}>
          <ProjectVariablesView nodes={nodes} edges={edges} />
        </div>
      )}

      {activeView === 'outputs' && (
        <div className="wp-legacy-token-scope flex-1 overflow-hidden p-4" style={{ ...LEGACY_TOKEN_SCOPE_STYLE, background: 'var(--ground)' }}>
          <LiveCodePreview selectedNode={null} nodes={nodes} edges={edges} />
        </div>
      )}

      <ConsoleBar
        isOpen={isTerminalOpen}
        onToggle={() => setIsTerminalOpen(!isTerminalOpen)}
        logs={logs}
        onClearLogs={() => setLogs('')}
        deployStatus={planStatus !== 'IDLE' ? planStatus : deployStatus}
        terminalEndRef={terminalEndRef}
      />

      <ProjectSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        projectDetails={projectDetails as Project}
        onUpdateProjectDetails={(updated) => setProjectDetails(updated)}
        projectId={projectId}
        onCredentialsChange={setAvailableCredentials}
      />

      <CustomNodeModal
        isOpen={isCustomNodeOpen}
        onClose={() => setIsCustomNodeOpen(false)}
        projectId={projectId}
      />
    </div>
  );
}

export default function WorkspacePage() {
  return (
    <div className="h-screen w-full bg-background text-foreground flex flex-col relative font-sans overflow-hidden">
      <ReactFlowProvider>
        <Suspense fallback={
          <div className="min-h-screen w-full bg-background flex items-center justify-center text-slate-400">
            <Icon icon="lucide:loader-2" className="animate-spin text-2xl text-primary" />
          </div>
        }>
          <WorkspaceContent />
        </Suspense>
      </ReactFlowProvider>
    </div>
  );
}
