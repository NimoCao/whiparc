import { describe, expect, it } from "vitest";
import { TOUR_GAP, TOUR_MARGIN, blockerClip, placePopover, type Box, type Size } from "../tourPlacement";

const VP: Size = { w: 1280, h: 800 };
const CARD: Size = { w: 340, h: 220 };

function inside(placed: { top: number; left: number }, pop: Size, vp: Size) {
  expect(placed.left).toBeGreaterThanOrEqual(TOUR_MARGIN);
  expect(placed.top).toBeGreaterThanOrEqual(TOUR_MARGIN);
  expect(placed.left + pop.w).toBeLessThanOrEqual(vp.w - TOUR_MARGIN);
  expect(placed.top + pop.h).toBeLessThanOrEqual(vp.h - TOUR_MARGIN);
}

describe("placePopover", () => {
  it("centers the card when a step has no target", () => {
    const placed = placePopover(null, CARD, VP);
    expect(placed.placement).toBe("center");
    expect(placed.left).toBe((VP.w - CARD.w) / 2);
    expect(placed.top).toBe((VP.h - CARD.h) / 2);
  });

  it("puts the card on the preferred side when there is room", () => {
    const sidebar: Box = { top: 70, left: 4, width: 208, height: 300 };
    const placed = placePopover(sidebar, CARD, VP, "right");
    expect(placed.placement).toBe("right");
    expect(placed.left).toBe(sidebar.left + sidebar.width + TOUR_GAP);
    inside(placed, CARD, VP);
  });

  it("flips to the opposite side when the preferred one would clip", () => {
    const edge: Box = { top: 300, left: VP.w - 120, width: 100, height: 40 };
    const placed = placePopover(edge, CARD, VP, "right");
    expect(placed.placement).not.toBe("right");
    inside(placed, CARD, VP);
  });

  it("falls back to the top when the target sits at the bottom of the viewport", () => {
    const low: Box = { top: VP.h - 120, left: 400, width: 500, height: 100 };
    const placed = placePopover(low, CARD, VP, "bottom");
    expect(placed.placement).toBe("top");
    expect(placed.top + CARD.h + TOUR_GAP).toBe(low.top);
    inside(placed, CARD, VP);
  });

  it("keeps the card inside the viewport when the target hugs a corner", () => {
    const corner: Box = { top: 8, left: VP.w - 150, width: 140, height: 40 };
    const placed = placePopover(corner, CARD, VP, "bottom");
    expect(placed.placement).toBe("bottom");
    inside(placed, CARD, VP);
  });

  it("overlaps the target as a last resort for a viewport-sized target", () => {
    const huge: Box = { top: 0, left: 0, width: VP.w, height: VP.h };
    const placed = placePopover(huge, CARD, VP, "bottom");
    expect(placed.placement).toBe("overlap");
    inside(placed, CARD, VP);
  });

  it("docks to an edge on narrow screens, away from the target", () => {
    const narrow: Size = { w: 390, h: 844 };
    const card: Size = { w: 358, h: 240 };
    const upper = placePopover({ top: 80, left: 16, width: 200, height: 40 }, card, narrow, "right");
    expect(upper.placement).toBe("sheet");
    expect(upper.top + card.h).toBe(narrow.h - TOUR_MARGIN);
    const lower = placePopover({ top: 700, left: 16, width: 200, height: 40 }, card, narrow, "right");
    expect(lower.placement).toBe("sheet");
    expect(lower.top).toBe(TOUR_MARGIN);
    inside(upper, card, narrow);
    inside(lower, card, narrow);
  });
});

describe("blockerClip", () => {
  it("does not clip at all when nothing is allowed, so everything stays blocked", () => {
    expect(blockerClip(VP, [])).toBeUndefined();
  });

  it("cuts one even-odd hole per allowed region out of the viewport", () => {
    const library: Box = { top: 60, left: 0, width: 216, height: 700 };
    const canvas: Box = { top: 60, left: 216, width: 700, height: 700 };
    expect(blockerClip(VP, [library, canvas])).toBe(
      'path(evenodd, "M0 0H1280V800H0ZM0 60h216v700h-216ZM216 60h700v700h-700Z")'
    );
  });
});
