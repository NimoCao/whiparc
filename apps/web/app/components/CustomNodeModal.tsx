'use client';

import React, { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { useAuthStore } from '../store/useAuthStore';
import useCanvasStore from '../store/useCanvasStore';
import type { CustomLibraryNode } from '../store/useCanvasStore';
import { BlueprintCorners } from './ui/BlueprintCorners';
import { techColor } from '../lib/canvasDesign';
import './ui/blueprint.css';
import './CustomNodeModal.css';

interface CustomNodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
}

interface ValidationError {
  line: number;
  column: number;
  message: string;
}

const TECH_OPTIONS = [
  { value: 'Terraform', label: 'Terraform Resource / Module' },
  { value: 'Ansible', label: 'Ansible Task / Block' },
  { value: 'Kubernetes', label: 'Kubernetes Resource' },
] as const;

const KICKER_STYLE = {
  fontFamily: 'var(--font-mono-marketing, ui-monospace, monospace)',
  fontSize: 10,
  letterSpacing: '.1em',
  textTransform: 'uppercase',
} as const;

export default function CustomNodeModal({ isOpen, onClose, projectId }: CustomNodeModalProps) {
  const { user, token, upgradePlan } = useAuthStore();
  const { addCustomLibraryNode, addNode } = useCanvasStore();

  const [tech, setTech] = useState<'Terraform' | 'Ansible' | 'Kubernetes'>('Terraform');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [rawCode, setRawCode] = useState('');
  
  const [isValidating, setIsValidating] = useState(false);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [extractedParams, setExtractedParams] = useState<string[]>([]);
  const [isValid, setIsValid] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [isTechDropdownOpen, setIsTechDropdownOpen] = useState(false);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const isPremium = user?.plan === 'PRO' || user?.plan === 'ENTERPRISE';

  // Sync default code template when tech changes.
  // Resetting the editor's template + validation state to match the
  // selected tech is the intended effect here.
  useEffect(() => {
    if (tech === 'Terraform') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRawCode(`resource "aws_redis_cluster" "redis" {
  cluster_id           = "infra-cache"
  node_type            = "cache.t3.micro"
  num_cache_nodes      = var.node_count
  parameter_group_name = "default.redis7"
  port                 = 6379
}

variable "node_count" {
  type    = number
  default = 1
}`);
    } else if (tech === 'Ansible') {
      setRawCode(`- name: Ensure nginx container is running
  community.docker.docker_container:
    name: nginx-server
    image: "{{ nginx_version }}"
    state: started
    ports:
      - "80:80"`);
    } else if (tech === 'Kubernetes') {
      setRawCode(`apiVersion: apps/v1
kind: Deployment
metadata:
  name: cache-deployment
  labels:
    app: redis-cache
spec:
  replicas: 1
  selector:
    matchLabels:
      app: redis-cache
  template:
    metadata:
      labels:
        app: redis-cache
    spec:
      containers:
      - name: redis
        image: redis:7.0-alpine
        ports:
        - containerPort: 6379`);
    }
    setIsValid(false);
    setValidationErrors([]);
    setExtractedParams([]);
  }, [tech]);

  if (!isOpen) return null;

  const handleUpgrade = async () => {
    setUpgradeLoading(true);
    const success = await upgradePlan('PRO');
    setUpgradeLoading(false);
    if (!success) {
      alert("Failed to activate premium sandbox upgrade.");
    }
  };

  const handleValidate = async () => {
    if (!rawCode.trim()) return;
    setIsValidating(true);
    setValidationErrors([]);
    setIsValid(false);

    try {
      const res = await fetch(`${API_URL}/api/custom-nodes/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          tech,
          code_type: tech === 'Terraform' ? 'tf' : 'yml',
          raw_code: rawCode
        })
      });

      if (res.ok) {
        const data = await res.json();
        setIsValid(data.valid);
        if (!data.valid) {
          setValidationErrors(data.errors || []);
        } else {
          setExtractedParams(data.extracted_params || []);
        }
      } else {
        const errText = await res.text();
        setValidationErrors([{ line: 1, column: 1, message: "Server validation failed: " + errText }]);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setValidationErrors([{ line: 1, column: 1, message: "Failed to connect to syntax engine: " + message }]);
    } finally {
      setIsValidating(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || !title.trim() || isSaving) return;

    setIsSaving(true);
    try {
      const metaObj = {
        parameters: extractedParams.reduce((acc, p) => ({ ...acc, [p]: "" }), {})
      };

      const res = await fetch(`${API_URL}/api/projects/${projectId}/custom-nodes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          title,
          tech,
          category: category.trim() || 'Custom Blocks',
          description: description.trim() || `Custom ${tech} Automation Block`,
          code_type: tech === 'Terraform' ? 'tf' : 'yml',
          raw_code: rawCode,
          parsed_meta_json: JSON.stringify(metaObj)
        })
      });

      if (res.ok) {
        const result = await res.json();
        const customBlock: CustomLibraryNode = {
          id: result.id,
          project_id: projectId,
          title,
          tech,
          category: category.trim() || 'Custom Blocks',
          description: description.trim() || `Custom ${tech} Automation Block`,
          code_type: tech === 'Terraform' ? 'tf' : 'yml',
          raw_code: rawCode,
          parsed_meta_json: JSON.stringify(metaObj)
        };

        // Add to local state libraries
        addCustomLibraryNode(customBlock);

        // Instantly drop on canvas at random location close to center
        const posX = 250 + Math.random() * 100;
        const posY = 200 + Math.random() * 100;

        const newNode = {
          id: `custom_${result.id}_${Date.now()}`,
          type: 'customNode',
          position: { x: posX, y: posY },
          data: {
            label: title,
            tech,
            icon: tech === 'Terraform' ? 'devicon:terraform' : tech === 'Ansible' ? 'devicon:ansible' : 'devicon:kubernetes',
            categoryLabel: category.trim() || 'Custom Blocks',
            description: description.trim() || `Custom ${tech} Automation Block`,
            status: 'Validated' as const,
            statusText: 'Custom Block',
            isCustom: true,
            rawCode,
            codeType: tech === 'Terraform' ? 'tf' : 'yml',
            parameters: metaObj.parameters
          }
        };

        addNode(newNode);
        onClose();
      } else {
        const errText = await res.text();
        alert("Failed to save custom block template: " + errText);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      alert("Error saving custom template: " + message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(2px)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      
      {/* PAYWALL UPGRADE STATE */}
      {!isPremium ? (
        <div
          className="wp-blueprint"
          role="dialog"
          aria-modal="true"
          aria-labelledby="wp-cnm-paywall-title"
          style={{ position: 'relative', width: 480, maxWidth: '100%', background: 'var(--panel)', padding: 24 }}
        >
          <BlueprintCorners />

          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '1px 6px',
                border: '1px solid var(--amber)',
                color: 'var(--amber)',
                fontFamily: 'var(--font-mono-marketing, ui-monospace, monospace)',
                fontSize: 9.5,
                letterSpacing: '.08em',
              }}
            >
              <Icon icon="lucide:lock" width={9} />
              PRO
            </span>
            <button
              type="button"
              onClick={onClose}
              className="wp-cnm-close"
              aria-label="Close"
              style={{ background: 'none', border: 0, padding: 4, margin: -4, color: 'var(--ink2)', cursor: 'pointer', display: 'flex' }}
            >
              <Icon icon="lucide:x" width={16} />
            </button>
          </div>

          <h3
            id="wp-cnm-paywall-title"
            style={{ margin: '14px 0 0', fontFamily: 'var(--font-display, inherit)', fontWeight: 600, fontSize: 22, letterSpacing: '-.01em', color: 'var(--ink)' }}
          >
            Upgrade to Premium
          </h3>
          <p style={{ margin: '8px 0 0', fontSize: 13.5, lineHeight: 1.55, color: 'var(--ink2)' }}>
            Unlock custom visual blocks to upload, syntax validate, and drop your own infrastructure-as-code scripts.
          </p>

          <p
            style={{
              margin: '20px 0 8px',
              fontFamily: 'var(--font-mono-marketing, ui-monospace, monospace)',
              fontSize: 9.5,
              letterSpacing: '.12em',
              textTransform: 'uppercase',
              color: 'var(--ink3)',
            }}
          >
            Included
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', border: '1px solid var(--line)' }}>
            {[
              'Upload Custom Terraform HCL & Kubernetes Manifests',
              'Author Reusable Ansible Service & Playbook Tasks',
              'Extract Variables Dynamically into the Inspector Panel',
            ].map((feature, i) => (
              <li
                key={feature}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  borderTop: i === 0 ? 0 : '1px solid var(--line)',
                  fontSize: 13,
                  color: 'var(--ink)',
                }}
              >
                <Icon icon="lucide:check" width={14} style={{ flexShrink: 0, color: 'var(--accent-ink)' }} />
                {feature}
              </li>
            ))}
          </ul>

          <div style={{ marginTop: 24, display: 'grid', gap: 16 }}>
            <button
              type="button"
              onClick={handleUpgrade}
              disabled={upgradeLoading}
              className="wp-blueprint wp-cnm-primary"
              style={{
                height: 42,
                border: 0,
                background: 'var(--accent)',
                color: 'var(--on-accent)',
                fontFamily: 'var(--font-display, inherit)',
                fontWeight: 600,
                fontSize: 14,
                cursor: upgradeLoading ? 'default' : 'pointer',
                opacity: upgradeLoading ? 0.6 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <BlueprintCorners />
              {upgradeLoading ? <Icon icon="lucide:loader-2" width={15} className="animate-spin" /> : <Icon icon="lucide:zap" width={15} />}
              Upgrade to Pro (Instant Sandbox)
            </button>
            <button
              type="button"
              onClick={onClose}
              className="wp-cnm-secondary"
              style={{
                height: 40,
                border: '1px solid var(--line)',
                background: 'transparent',
                color: 'var(--ink)',
                fontFamily: 'var(--font-display, inherit)',
                fontWeight: 600,
                fontSize: 13.5,
                cursor: 'pointer',
              }}
            >
              Maybe Later
            </button>
          </div>
        </div>
      ) : (

        /* CODE EDITOR & CREATION DIALOG */
        <div
          className="wp-blueprint"
          role="dialog"
          aria-modal="true"
          aria-labelledby="wp-cnm-title"
          style={{ position: 'relative', width: 800, maxWidth: '100%', height: '85vh', display: 'flex', flexDirection: 'column', background: 'var(--panel)' }}
        >
          <BlueprintCorners />

          {/* Header */}
          <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0 }}>
            <div>
              <h3 id="wp-cnm-title" style={{ margin: 0, fontFamily: 'var(--font-display, inherit)', fontWeight: 600, fontSize: 17, color: 'var(--ink)' }}>
                Create Custom Automation Block
              </h3>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ink2)' }}>
                Synthesize your own configuration manifests into draggable visual objects.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="wp-cnm-close"
              aria-label="Close"
              style={{ background: 'none', border: 0, padding: 4, color: 'var(--ink2)', cursor: 'pointer', display: 'flex', flexShrink: 0 }}
            >
              <Icon icon="lucide:x" width={16} />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleCreate} style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            {/* Left side inputs */}
            <div style={{ width: 300, flexShrink: 0, borderRight: '1px solid var(--line)', padding: 20, display: 'grid', gap: 16, alignContent: 'start', overflowY: 'auto' }}>
              <div>
                <label htmlFor="wp-cnm-block-title" style={{ ...KICKER_STYLE, display: 'block', marginBottom: 6, color: 'var(--ink2)' }}>
                  Block Title
                </label>
                <input
                  id="wp-cnm-block-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  placeholder="e.g. AWS Redshift Cluster"
                  className="wp-cnm-field"
                />
              </div>

              <div>
                <span style={{ ...KICKER_STYLE, display: 'block', marginBottom: 6, color: 'var(--ink2)' }}>Technology Type</span>
                <div style={{ position: 'relative' }}>
                  <button
                    type="button"
                    onClick={() => setIsTechDropdownOpen(!isTechDropdownOpen)}
                    className="wp-cnm-field"
                    aria-haspopup="listbox"
                    aria-expanded={isTechDropdownOpen}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', textAlign: 'left', cursor: 'pointer' }}
                  >
                    <span>{TECH_OPTIONS.find((o) => o.value === tech)?.label}</span>
                    <Icon icon="lucide:chevron-down" width={13} style={{ color: 'var(--ink3)' }} />
                  </button>
                  {isTechDropdownOpen && (
                    <>
                      <div style={{ position: 'fixed', inset: 0, zIndex: 10 }} onClick={() => setIsTechDropdownOpen(false)} />
                      <div role="listbox" style={{ position: 'absolute', top: '100%', left: 0, width: '100%', marginTop: 4, zIndex: 20, background: 'var(--panel)', border: '1px solid var(--line)', boxShadow: '0 12px 32px -12px rgba(0,0,0,.5)' }}>
                        {TECH_OPTIONS.map((o, i) => (
                          <button
                            key={o.value}
                            type="button"
                            role="option"
                            aria-selected={tech === o.value}
                            onClick={() => {
                              setTech(o.value);
                              setIsTechDropdownOpen(false);
                            }}
                            className="wp-cnm-option"
                            style={{ borderTop: i === 0 ? 0 : '1px solid var(--line)', color: tech === o.value ? 'var(--accent-ink)' : 'var(--ink)' }}
                          >
                            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ width: 6, height: 6, background: techColor(o.value), flexShrink: 0 }} />
                              {o.label}
                            </span>
                            {tech === o.value && <Icon icon="lucide:check" width={13} />}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div>
                <label htmlFor="wp-cnm-category" style={{ ...KICKER_STYLE, display: 'block', marginBottom: 6, color: 'var(--ink2)' }}>
                  Category
                </label>
                <input
                  id="wp-cnm-category"
                  type="text"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="e.g. Database, Custom Blocks"
                  className="wp-cnm-field"
                />
              </div>

              <div>
                <label htmlFor="wp-cnm-description" style={{ ...KICKER_STYLE, display: 'block', marginBottom: 6, color: 'var(--ink2)' }}>
                  Description
                </label>
                <textarea
                  id="wp-cnm-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="e.g. Deploys custom cache nodes inside production VPCs..."
                  className="wp-cnm-field"
                />
              </div>

              {isValid && (
                <div style={{ padding: 12, border: '1px solid var(--success)', background: 'color-mix(in srgb, var(--success) 8%, transparent)', color: 'var(--success)', fontSize: 12, lineHeight: 1.5 }}>
                  <div style={{ ...KICKER_STYLE, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontSize: 10.5 }}>
                    <Icon icon="lucide:check" width={13} /> Validated Successfully
                  </div>
                  {extractedParams.length > 0 ? (
                    <div>
                      Extracted Parameters:
                      <div style={{ marginTop: 6, display: 'grid', gap: 2, fontFamily: 'var(--font-mono-marketing, ui-monospace, monospace)', fontSize: 11 }}>
                        {extractedParams.map((p) => (
                          <div key={p}>{p}</div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <span>Code block syntax is clean. No parameters detected.</span>
                  )}
                </div>
              )}

              {validationErrors.length > 0 && (
                <div style={{ padding: 12, border: '1px solid var(--danger)', background: 'color-mix(in srgb, var(--danger) 8%, transparent)', color: 'var(--danger)', fontSize: 12, lineHeight: 1.5, maxHeight: 180, overflowY: 'auto' }}>
                  <div style={{ ...KICKER_STYLE, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontSize: 10.5 }}>
                    <Icon icon="lucide:alert-circle" width={13} /> Syntax Validation Error
                  </div>
                  <div style={{ display: 'grid', gap: 4, fontFamily: 'var(--font-mono-marketing, ui-monospace, monospace)', fontSize: 11 }}>
                    {validationErrors.map((err, i) => (
                      <div key={i}>
                        Line {err.line}:{err.column} - {err.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right side editor */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--ground)' }}>
              {/* File bar */}
              <div style={{ height: 44, padding: '0 16px', flexShrink: 0, borderBottom: '1px solid var(--line)', background: 'var(--panel)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', userSelect: 'none' }}>
                <span style={{ ...KICKER_STYLE, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink2)' }}>
                  <Icon icon="lucide:file-code" width={13} style={{ color: 'var(--accent-ink)' }} />
                  {tech === 'Terraform' ? 'custom.tf' : 'custom_tasks.yml'}
                </span>
                <button
                  type="button"
                  onClick={handleValidate}
                  disabled={isValidating}
                  className="wp-cnm-ghost"
                  style={{ height: 28, padding: '0 12px', border: '1px solid var(--accent-ink)', background: 'transparent', color: 'var(--accent-ink)', fontFamily: 'var(--font-display, inherit)', fontWeight: 600, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, cursor: isValidating ? 'default' : 'pointer', opacity: isValidating ? 0.6 : 1 }}
                >
                  {isValidating && <Icon icon="lucide:loader-2" width={12} className="animate-spin" />}
                  Validate Script
                </button>
              </div>

              {/* Code textarea */}
              <textarea
                value={rawCode}
                onChange={(e) => {
                  setRawCode(e.target.value);
                  setIsValid(false);
                }}
                required
                spellCheck={false}
                aria-label="Automation block source"
                placeholder="Paste your IaC automation block here..."
                className="wp-cnm-code"
              />

              {/* Action footer */}
              <div style={{ padding: '14px 22px', flexShrink: 0, borderTop: '1px solid var(--line)', background: 'var(--panel)', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 16 }}>
                <button
                  type="button"
                  onClick={onClose}
                  className="wp-cnm-secondary"
                  style={{ height: 36, padding: '0 16px', border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink)', fontFamily: 'var(--font-display, inherit)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!isValid || !title.trim() || isSaving}
                  className="wp-blueprint wp-cnm-primary"
                  style={{ height: 36, padding: '0 18px', border: 0, background: 'var(--accent)', color: 'var(--on-accent)', fontFamily: 'var(--font-display, inherit)', fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                >
                  <BlueprintCorners />
                  {isSaving && <Icon icon="lucide:loader-2" width={14} className="animate-spin" />}
                  Add Visual Node to Canvas
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
