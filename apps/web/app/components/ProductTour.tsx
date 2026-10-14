'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Icon } from '@iconify/react';
import { BlueprintCorners } from './ui/BlueprintCorners';
import { TOUR_MARGIN, TOUR_PAD, blockerClip, placePopover, type Box, type Placement, type Size } from '../lib/tourPlacement';
import './product-tour.css';

export interface TourStep {
  id: string;
  // Value of the `data-tour` attribute on the element to spotlight. Omit for
  // a centered step. A step whose target is not in the DOM when the tour
  // starts is dropped, so conditional UI (e.g. the first-run checklist) can
  // have its own step without the tour pointing at nothing.
  target?: string;
  icon: string;
  title: string;
  body: ReactNode;
  placement?: Placement;
  // Makes the step interactive: instead of only reading, the user does
  // something on the page and the tour waits for it. The parent reports
  // whether it has happened through `taskDone` (keyed by step id), because
  // only the parent knows how to observe it (e.g. a canvas store).
  task?: TourTask;
}

export interface TourTask {
  // Shown in the card while the task is not done yet, and once it is.
  prompt: string;
  done: string;
  // `data-tour` values of the regions that stay clickable during this step.
  // Everything else under the dim is inert, so a guided step can never
  // trigger something unrelated (a Deploy button, say).
  allow: string[];
}

export type TourOutcome = 'finished' | 'skipped';

interface ProductTourProps {
  steps: TourStep[];
  onClose: (outcome: TourOutcome) => void;
  // Completion of interactive steps, keyed by step id. A step that is not
  // done can always be skipped, so a user never gets stuck waiting.
  taskDone?: Record<string, boolean>;
}

// `instant` snaps the spotlight and card to the new geometry (used for the
// first frame and while the page scrolls or resizes underneath the tour), so
// only a deliberate step change glides.
interface Frame {
  box: Box | null;
  // Boxes of the regions an interactive step leaves clickable.
  allow: Box[];
  instant: boolean;
}

const CARD_WIDTH = 360;
const EXIT_MS = 180;
const REMEASURE_MS = 400;

const selectorFor = (target: string) => `[data-tour="${target}"]`;

function readBox(el: Element): Box {
  const r = el.getBoundingClientRect();
  return { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) };
}

function readAllow(step: TourStep): Box[] {
  return (step.task?.allow ?? []).flatMap((t) => Array.from(document.querySelectorAll(selectorFor(t))).map(readBox));
}

const signature = (box: Box | null, allow: Box[]) => JSON.stringify([box, allow]);

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// A guided, step-by-step walkthrough: dims the page, spotlights one element
// at a time and explains it in a blueprint-styled card. Rendered inside the
// page's themed root (not portaled) so it inherits that page's design
// tokens in both light and dark.
export function ProductTour({ steps, onClose, taskDone = {} }: ProductTourProps) {
  const [active] = useState(() =>
    steps.filter((s) => !s.target || (typeof document !== 'undefined' && document.querySelector(selectorFor(s.target)) !== null))
  );
  const [nav, setNav] = useState({ index: 0, dir: 1 });
  const [frame, setFrame] = useState<Frame>({ box: null, allow: [], instant: true });
  const [vp, setVp] = useState<Size>(() => (typeof window === 'undefined' ? { w: 1280, h: 800 } : { w: window.innerWidth, h: window.innerHeight }));
  const [popSize, setPopSize] = useState<Size | null>(null);
  const [leaving, setLeaving] = useState<TourOutcome | null>(null);

  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const lastSignature = useRef('');
  const firstStep = useRef(true);
  const titleId = useId();
  const bodyId = useId();

  const last = active.length - 1;
  const step = active[nav.index];

  const requestClose = (outcome: TourOutcome) => setLeaving((cur) => cur ?? outcome);
  const go = (delta: 1 | -1) => {
    if (nav.index + delta > last) return requestClose('finished');
    if (nav.index + delta < 0) return;
    setNav({ index: nav.index + delta, dir: delta });
  };

  // Measure the spotlighted element for the current step, and keep it in sync
  // while the tour is open. The first measure of a step runs in a frame so the
  // page has settled, and animates (the glide); everything after it (scroll,
  // resize, layout shifts) snaps so the spotlight never lags behind content.
  useEffect(() => {
    if (!step) return;
    const el = step.target ? document.querySelector<HTMLElement>(selectorFor(step.target)) : null;
    if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });

    const publish = (instant: boolean) => {
      setVp({ w: window.innerWidth, h: window.innerHeight });
      const allow = readAllow(step);
      const box = el && el.isConnected ? readBox(el) : null;
      lastSignature.current = signature(box, allow);
      setFrame({ box, allow, instant });
    };
    const follow = () => {
      const box = el && el.isConnected ? readBox(el) : null;
      if (signature(box, readAllow(step)) === lastSignature.current) return;
      publish(true);
    };

    let ro: ResizeObserver | null = null;
    let timer: number | undefined;
    const isFirst = firstStep.current;
    firstStep.current = false;
    const raf = requestAnimationFrame(() => {
      publish(isFirst);
      window.addEventListener('resize', follow);
      window.addEventListener('scroll', follow, true);
      if (el) {
        ro = new ResizeObserver(follow);
        ro.observe(el);
      }
      // Late layout shifts (content loading in above the target) do not
      // resize the target itself, so poll cheaply; `follow` is a no-op while
      // nothing has moved.
      timer = window.setInterval(follow, REMEASURE_MS);
    });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', follow);
      window.removeEventListener('scroll', follow, true);
      ro?.disconnect();
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [step]);

  // The card's height changes per step, so placement needs its real size.
  useEffect(() => {
    const node = cardRef.current;
    if (!node) return;
    const ro = new ResizeObserver(() => setPopSize({ w: node.offsetWidth, h: node.offsetHeight }));
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  // Focus the primary action on open so Enter advances, and hand focus back
  // to whatever had it (the header "?" button on a replay) when the tour ends.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    nextRef.current?.focus({ preventScroll: true });
    return () => previous?.focus?.({ preventScroll: true });
  }, []);

  // Fade out, then tell the parent. Immediate under reduced motion.
  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => onClose(leaving), prefersReducedMotion() ? 0 : EXIT_MS);
    return () => window.clearTimeout(t);
  }, [leaving, onClose]);

  // Capture phase on window so the tour wins over the page's own shortcuts
  // (the dashboard's Cmd/Ctrl+K palette must not open under the spotlight).
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyHandler.current = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        e.stopPropagation();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        requestClose('skipped');
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        // During an interactive step focus is often on the page (a canvas
        // node, say) and the arrows belong to it, not to the tour.
        if (step?.task && !cardRef.current?.contains(e.target as Node)) return;
        e.preventDefault();
        go(e.key === 'ArrowRight' ? 1 : -1);
      }
    };
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  // Keep Tab inside the card: the page behind is inert while the tour runs.
  const trapTab = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const focusable = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled])'));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const lastEl = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && document.activeElement === lastEl) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!step) return null;

  const cardW = Math.min(CARD_WIDTH, vp.w - TOUR_MARGIN * 2);
  const size: Size = { w: cardW, h: popSize?.h ?? 230 };
  const hole: Box | null = frame.box
    ? {
        top: frame.box.top - TOUR_PAD,
        left: frame.box.left - TOUR_PAD,
        width: frame.box.width + TOUR_PAD * 2,
        height: frame.box.height + TOUR_PAD * 2,
      }
    : null;
  const placed = placePopover(hole, size, vp, step.placement);
  // With no target the spotlight collapses to a point at the center and only
  // its frame fades (the dimming shadow must stay), so the whole page is
  // dimmed and moving between a target and a centered step is a smooth zoom
  // instead of a pop.
  const holeStyle: CSSProperties = hole
    ? { top: hole.top, left: hole.left, width: hole.width, height: hole.height }
    : { top: vp.h / 2, left: vp.w / 2, width: 0, height: 0 };
  const instantClass = frame.instant ? ' wp-tour-instant' : '';
  const isLast = nav.index === last;
  const task = step.task;
  const isDone = !task || Boolean(taskDone[step.id]);

  return (
    <div className={`wp-tour-root${leaving ? ' wp-tour-out' : ''}`}>
      <div className="wp-tour-blocker" style={{ clipPath: blockerClip(vp, frame.allow) }} onMouseDown={(e) => e.preventDefault()} aria-hidden="true" />

      <div className={`wp-blueprint wp-tour-hole${hole ? '' : ' wp-tour-point'}${instantClass}`} style={holeStyle} aria-hidden="true">
        <BlueprintCorners />
      </div>

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className={`wp-blueprint wp-tour-card${instantClass}`}
        style={{ top: placed.top, left: placed.left, width: cardW, opacity: popSize ? 1 : 0 }}
        onKeyDown={trapTab}
      >
        <BlueprintCorners />

        <div key={step.id} className="wp-tour-content" style={{ '--wp-tour-dir': nav.dir } as CSSProperties} aria-live="polite">
          <div className="wp-tour-kicker">
            <Icon icon={step.icon} width={14} aria-hidden="true" />
            <span>
              Step {String(nav.index + 1).padStart(2, '0')} / {String(active.length).padStart(2, '0')}
            </span>
          </div>
          <h2 id={titleId} className="wp-tour-title">
            {step.title}
          </h2>
          <div id={bodyId} className="wp-tour-body">
            {step.body}
          </div>
          {task && (
            <div className="wp-tour-task" data-done={isDone}>
              <span className="wp-tour-task-mark" aria-hidden="true">
                {isDone ? '✓' : ''}
              </span>
              <span>{isDone ? task.done : task.prompt}</span>
            </div>
          )}
        </div>

        <div className="wp-tour-progress" aria-hidden="true">
          {active.map((s, i) => (
            <span key={s.id} className={i < nav.index ? 'done' : i === nav.index ? 'now' : undefined} />
          ))}
        </div>

        <div className="wp-tour-actions">
          {isLast ? (
            <span className="wp-tour-hint">← → to move</span>
          ) : (
            <button type="button" className="wp-tour-btn wp-tour-ghost" onClick={() => requestClose('skipped')}>
              Skip tour
            </button>
          )}
          <div className="wp-tour-actions-main">
            {nav.index > 0 && (
              <button type="button" className="wp-tour-btn" onClick={() => go(-1)}>
                Back
              </button>
            )}
            <button ref={nextRef} type="button" className="wp-tour-btn wp-tour-primary" onClick={() => go(1)}>
              {isLast ? 'Finish' : nav.index === 0 ? 'Start tour' : !isDone ? 'Skip step' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
