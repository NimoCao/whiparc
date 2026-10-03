'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AVATAR_MAX_SOURCE_BYTES, AVATAR_SIZE, sniffAvatarType } from '../lib/avatar';

interface AvatarCropperProps {
  file: File;
  onCancel: () => void;
  // Receives the cropped AVATAR_SIZE x AVATAR_SIZE PNG. Resolve to an error
  // message to keep the dialog open and show it, or null when done.
  onConfirm: (cropped: Blob) => Promise<string | null>;
}

const VIEW = 288; // on-screen crop window, px (square)
const MAX_ZOOM = 4;

// Client-side square cropper: drag to pan, slider/wheel to zoom, output is
// always a fresh AVATAR_SIZE-px PNG drawn through a canvas. The server
// re-validates and re-encodes regardless; this exists so users pick the framing
// and so a multi-megabyte camera photo never goes over the wire.
export default function AvatarCropper({ file, onCancel, onConfirm }: AvatarCropperProps) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 }); // image center relative to the window center, in window px
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  // Validate and decode the picked file.
  useEffect(() => {
    let revoked = false;
    let objectUrl = '';
    (async () => {
      if (file.size > AVATAR_MAX_SOURCE_BYTES) {
        setError('That image is over 10 MB. Pick a smaller one.');
        return;
      }
      const type = await sniffAvatarType(file);
      if (!type) {
        setError('Only .jpg and .png images are supported.');
        return;
      }
      objectUrl = URL.createObjectURL(file);
      const el = new Image();
      el.onload = () => {
        if (revoked) return;
        if (Math.min(el.naturalWidth, el.naturalHeight) < 32) {
          setError('That image is too small (32px minimum).');
          return;
        }
        setImg(el);
      };
      el.onerror = () => !revoked && setError('That file could not be read as an image.');
      el.src = objectUrl;
    })();
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  // Base scale makes the shorter side exactly fill the window at zoom 1.
  const baseScale = img ? VIEW / Math.min(img.naturalWidth, img.naturalHeight) : 1;

  const clampOffset = useCallback(
    (o: { x: number; y: number }, z: number) => {
      if (!img) return o;
      const w = img.naturalWidth * baseScale * z;
      const h = img.naturalHeight * baseScale * z;
      const maxX = Math.max(0, (w - VIEW) / 2);
      const maxY = Math.max(0, (h - VIEW) / 2);
      return { x: Math.min(maxX, Math.max(-maxX, o.x)), y: Math.min(maxY, Math.max(-maxY, o.y)) };
    },
    [img, baseScale],
  );

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, size: number) => {
      if (!img) return;
      const k = size / VIEW;
      const w = img.naturalWidth * baseScale * zoom * k;
      const h = img.naturalHeight * baseScale * zoom * k;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, size, size);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, size / 2 + offset.x * k - w / 2, size / 2 + offset.y * k - h / 2, w, h);
    },
    [img, baseScale, zoom, offset],
  );

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) draw(ctx, VIEW);
  }, [draw]);

  const setZoomClamped = (z: number) => {
    const next = Math.min(MAX_ZOOM, Math.max(1, z));
    setZoom(next);
    setOffset((o) => clampOffset(o, next));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setOffset(clampOffset({ x: drag.current.ox + e.clientX - drag.current.x, y: drag.current.oy + e.clientY - drag.current.y }, zoom));
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = 12;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const m = moves[e.key];
    if (m) {
      e.preventDefault();
      setOffset((o) => clampOffset({ x: o.x + m[0], y: o.y + m[1] }, zoom));
    } else if (e.key === '+' || e.key === '=') setZoomClamped(zoom + 0.1);
    else if (e.key === '-') setZoomClamped(zoom - 0.1);
  };

  const handleSave = async () => {
    if (!img) return;
    setSaving(true);
    setError(null);
    const out = document.createElement('canvas');
    out.width = AVATAR_SIZE;
    out.height = AVATAR_SIZE;
    const ctx = out.getContext('2d');
    if (!ctx) {
      setSaving(false);
      setError('Your browser cannot crop images.');
      return;
    }
    draw(ctx, AVATAR_SIZE);
    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
    if (!blob) {
      setSaving(false);
      setError('Could not prepare the cropped image.');
      return;
    }
    const message = await onConfirm(blob);
    setSaving(false);
    if (message) setError(message);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Crop your avatar"
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.6)', padding: 16 }}
      onKeyDown={(e) => e.key === 'Escape' && !saving && onCancel()}
    >
      <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', padding: 22, width: VIEW + 44, maxWidth: '100%' }}>
        <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--ink)' }}>Crop your avatar</h3>
        <p style={{ margin: '6px 0 14px', fontSize: 12.5, color: 'var(--ink2)' }}>
          Drag to reposition, zoom to fit. Saved as a {AVATAR_SIZE}×{AVATAR_SIZE} image.
        </p>

        <div
          tabIndex={0}
          role="application"
          aria-label="Crop area. Arrow keys move the image, plus and minus zoom."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={(e) => setZoomClamped(zoom - e.deltaY * 0.002)}
          onKeyDown={onKeyDown}
          style={{ position: 'relative', width: VIEW, height: VIEW, background: 'var(--elevated)', touchAction: 'none', cursor: img ? 'grab' : 'default', outline: 'none', overflow: 'hidden' }}
        >
          <canvas ref={canvasRef} width={VIEW} height={VIEW} style={{ width: VIEW, height: VIEW, display: 'block' }} />
          {/* Round preview ring: avatars render as circles in some places. */}
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', boxShadow: '0 0 0 999px rgba(0,0,0,.35)', pointerEvents: 'none', border: '1px solid rgba(255,255,255,.6)' }} />
        </div>

        <label style={{ display: 'grid', gap: 6, marginTop: 14 }}>
          <span style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink2)' }}>Zoom</span>
          <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom} disabled={!img || saving} onChange={(e) => setZoomClamped(parseFloat(e.target.value))} />
        </label>

        {error && (
          <p role="alert" style={{ margin: '12px 0 0', fontSize: 12.5, color: 'var(--danger)' }}>
            {error}
          </p>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" onClick={onCancel} disabled={saving} style={{ height: 34, padding: '0 14px', fontSize: 12.5, border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink)', cursor: 'pointer' }}>
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={!img || saving} style={{ height: 34, padding: '0 14px', fontSize: 12.5, fontWeight: 500, border: 0, background: 'var(--accent)', color: 'var(--on-accent)', cursor: !img || saving ? 'default' : 'pointer', opacity: !img || saving ? 0.6 : 1 }}>
            {saving ? 'Uploading…' : 'Save avatar'}
          </button>
        </div>
      </div>
    </div>
  );
}
