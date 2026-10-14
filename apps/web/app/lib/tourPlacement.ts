export type Placement = 'right' | 'bottom' | 'left' | 'top';

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Size {
  w: number;
  h: number;
}

export interface Placed {
  top: number;
  left: number;
  // `center` is a step with no target, `sheet` is the narrow-screen bottom
  // (or top) dock, `overlap` is the last resort when nothing fits beside the
  // target and the card has to sit over part of it.
  placement: Placement | 'center' | 'sheet' | 'overlap';
}

// Space between the highlighted box and the card, and the minimum distance
// the card keeps from every viewport edge.
export const TOUR_GAP = 14;
export const TOUR_MARGIN = 16;
// Breathing room added around a target so the highlight frames it instead of
// hugging its border.
export const TOUR_PAD = 6;
// Below this viewport width the card docks to an edge instead of floating
// next to its target.
export const TOUR_SHEET_BELOW = 640;

const ORDER: Record<Placement, Placement[]> = {
  right: ['right', 'bottom', 'left', 'top'],
  bottom: ['bottom', 'top', 'right', 'left'],
  left: ['left', 'bottom', 'right', 'top'],
  top: ['top', 'bottom', 'right', 'left'],
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

// Picks where the tour card goes relative to the highlighted `target` (already
// padded; null for a step with no target). Tries the preferred side first and
// falls back through the others, so a target near a viewport edge flips the
// card to the side that has room rather than clipping it.
export function placePopover(target: Box | null, pop: Size, vp: Size, preferred: Placement = 'bottom'): Placed {
  const m = TOUR_MARGIN;
  const maxLeft = vp.w - pop.w - m;
  const maxTop = vp.h - pop.h - m;

  if (!target) {
    return { top: clamp((vp.h - pop.h) / 2, m, maxTop), left: clamp((vp.w - pop.w) / 2, m, maxLeft), placement: 'center' };
  }

  const centerX = target.left + target.width / 2;
  const centerY = target.top + target.height / 2;

  if (vp.w < TOUR_SHEET_BELOW) {
    // Dock on the side of the screen the target is not on.
    const top = centerY > vp.h / 2 ? m : maxTop;
    return { top: Math.max(m, top), left: clamp((vp.w - pop.w) / 2, m, maxLeft), placement: 'sheet' };
  }

  for (const side of ORDER[preferred]) {
    switch (side) {
      case 'right': {
        const left = target.left + target.width + TOUR_GAP;
        if (left <= maxLeft) return { top: clamp(centerY - pop.h / 2, m, maxTop), left, placement: side };
        break;
      }
      case 'left': {
        const left = target.left - TOUR_GAP - pop.w;
        if (left >= m) return { top: clamp(centerY - pop.h / 2, m, maxTop), left, placement: side };
        break;
      }
      case 'bottom': {
        const top = target.top + target.height + TOUR_GAP;
        if (top <= maxTop) return { top, left: clamp(centerX - pop.w / 2, m, maxLeft), placement: side };
        break;
      }
      case 'top': {
        const top = target.top - TOUR_GAP - pop.h;
        if (top >= m) return { top, left: clamp(centerX - pop.w / 2, m, maxLeft), placement: side };
        break;
      }
    }
  }

  return { top: Math.max(m, maxTop), left: clamp(centerX - pop.w / 2, m, maxLeft), placement: 'overlap' };
}

// CSS `clip-path` for the tour's click-blocking layer, which covers the whole
// viewport. An even-odd path with one hole per allowed region makes exactly
// those regions click-through (clipped-away areas receive no pointer events).
// Returns undefined when nothing is allowed, i.e. no clip: the layer blocks
// everything.
export function blockerClip(vp: Size, allow: Box[]): string | undefined {
  if (allow.length === 0) return undefined;
  const holes = allow.map((b) => `M${b.left} ${b.top}h${b.width}v${b.height}h${-b.width}Z`).join('');
  return `path(evenodd, "M0 0H${vp.w}V${vp.h}H0Z${holes}")`;
}
