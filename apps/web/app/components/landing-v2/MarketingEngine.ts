import { PALETTES, clamp01, easeInOutCubic, type ThemeMode, type Band } from './palette';

// Scroll-driven behaviour for the v2 marketing page: sticky nav theme
// tracking, per-band dark/light repainting, hero + "how it works" wire
// drawing, the two pinned scrollytelling tracks ("how it works" stages and
// "rough edges" cards), parallax, and reveal-on-scroll.
//
// Ported near-verbatim from the Claude Design prototype's own vanilla-JS
// runtime (a scroll + rAF loop over querySelector'd DOM nodes) rather than
// rebuilt as per-element React state, because the math (bezier wire
// routing, segment/local-progress split, band-aware repainting) is already
// correct and exercised in the design — translating it to idiomatic
// React state for ~10 different scroll-linked effects would multiply the
// surface area for a regression with no behavioural upside.
export class MarketingEngine {
  private root: HTMLElement;
  private reducedMotion: boolean;
  private mode: ThemeMode = 'scroll';

  private bands: HTMLElement[] = [];
  private nav: HTMLElement | null = null;
  private cta: HTMLElement | null = null;
  private githubLink: HTMLElement | null = null;
  private seg: HTMLElement | null = null;
  private segBtns: HTMLElement[] = [];
  private stageSection: HTMLElement | null = null;
  private stages: HTMLElement[] = [];
  private steps: HTMLElement[] = [];
  private nodes: HTMLElement[] = [];
  private edges: (SVGPathElement & { __len?: number; __on?: boolean })[] = [];
  private tips: SVGPathElement[] = [];
  private codeLines: HTMLElement[] = [];
  private logLines: HTMLElement[] = [];
  private bar: HTMLElement | null = null;
  private parallax: HTMLElement[] = [];
  private reveals: HTMLElement[] = [];
  private seams: HTMLElement[] = [];
  private graphs: SVGSVGElement[] = [];
  private limitTrack: HTMLElement | null = null;
  private limitCards: HTMLElement[] = [];
  private limitRows: HTMLElement[] = [];
  private limitBar: HTMLElement | null = null;
  private limitCount: HTMLElement | null = null;

  private io: IntersectionObserver | null = null;
  private raf = 0;
  private navNow: Band | null = null;
  private destroyed = false;
  private settleTimeout: ReturnType<typeof setTimeout> | null = null;

  private tick = () => {
    if (this.destroyed || this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (!this.destroyed) this.frame();
    });
  };

  private relayout = () => {
    if (this.destroyed) return;
    this.layoutGraphs();
    this.frame();
  };

  constructor(root: HTMLElement, reducedMotion: boolean) {
    this.root = root;
    this.reducedMotion = reducedMotion;
  }

  private motionOn() {
    return !this.reducedMotion;
  }

  // visualViewport tracks the actual visible area on mobile browsers where
  // window.innerHeight jumps as the address bar shows/hides mid-scroll —
  // using it keeps the pinned-stage and wipe progress math from jittering.
  private viewportHeight() {
    return (typeof window !== 'undefined' && window.visualViewport?.height) || window.innerHeight;
  }

  // Parallax reads naturally as a desktop flourish; scale its magnitude
  // down on narrow viewports rather than disabling it outright, since it's
  // one of the explicitly-required "keep animating on mobile" effects.
  private parallaxScale() {
    const w = window.innerWidth;
    if (w < 480) return 0.35;
    if (w < 768) return 0.55;
    if (w < 1024) return 0.8;
    return 1;
  }

  private collect(): boolean {
    const r = this.root;
    if (!r || !r.isConnected) return false;
    const all = <T extends Element = HTMLElement>(sel: string) => Array.from(r.querySelectorAll<T>(sel));
    this.bands = all('[data-band]');
    this.nav = r.querySelector('[data-nav]');
    this.cta = r.querySelector('[data-cta]');
    this.githubLink = r.querySelector('[data-gh]');
    this.seg = r.querySelector('[data-seg]');
    this.segBtns = all('[data-seg-btn]');
    this.stageSection = r.querySelector('[data-stage-section]');
    this.stages = all('[data-stage]');
    this.steps = all('[data-step]');
    this.nodes = all('[data-node]');
    this.edges = all<SVGPathElement>('[data-edge]');
    this.tips = all<SVGPathElement>('[data-tip]');
    this.codeLines = all('[data-code-line]');
    this.logLines = all('[data-log-line]');
    this.bar = r.querySelector('[data-progress]');
    this.parallax = all('[data-parallax]');
    this.reveals = all('[data-reveal]');
    this.seams = all('[data-seam]');
    this.graphs = all<SVGSVGElement>('[data-graph]');
    this.limitTrack = r.querySelector('[data-limit-track]');
    this.limitCards = all('[data-limit-card]');
    this.limitRows = all('[data-limit-row]');
    this.limitBar = r.querySelector('[data-limit-bar]');
    this.limitCount = r.querySelector('[data-limit-count]');
    return true;
  }

  private limitFrame(motion: boolean) {
    if (!this.limitTrack || !this.limitCards.length) return;
    const n = this.limitCards.length;
    const rect = this.limitTrack.getBoundingClientRect();
    const span = Math.max(1, this.limitTrack.offsetHeight - this.viewportHeight());
    const p = clamp01(-rect.top / span);
    const seg = p * n;
    const idx = Math.min(n - 1, Math.floor(seg));
    const local = clamp01(seg - idx);
    const band = this.limitTrack.closest<HTMLElement>('[data-band]');
    const pal = PALETTES[((band?.getAttribute('data-theme-now') as Band) || 'dark')];

    if (this.limitBar) this.limitBar.style.width = (p * 100).toFixed(2) + '%';
    if (this.limitCount) this.limitCount.textContent = '0' + (idx + 1) + ' / 0' + n;

    this.limitCards.forEach((card, i) => {
      const on = i === idx;
      const near = !on && Math.abs(i - idx) === 1 ? clamp01(i < idx ? local : 1 - local) : 0;
      card.style.transition = 'opacity .55s cubic-bezier(.22,.7,.3,1), transform .55s cubic-bezier(.22,.7,.3,1)';
      card.style.opacity = on ? '1' : String(near * 0.3);
      card.style.transform = on ? 'none' : 'translateY(' + (i < idx ? -18 : 18) + 'px)';
      card.style.pointerEvents = on ? 'auto' : 'none';
      card.style.zIndex = on ? '2' : '1';
      if (!motion) return;
      const parts = card.querySelectorAll<HTMLElement>('[data-limit-part]');
      parts.forEach((el, j) => {
        const t = on ? clamp01((local + 0.22 - j * 0.12) * 3.4) : 0;
        el.style.transition = 'opacity .4s ease, transform .4s cubic-bezier(.16,.84,.3,1)';
        el.style.opacity = on ? String(Math.max(0.15, t)) : '0';
        el.style.transform = 'translateY(' + ((1 - t) * 14).toFixed(1) + 'px)';
      });
    });

    this.limitRows.forEach((row, i) => {
      const on = i === idx;
      const past = i < idx;
      row.style.transition = 'background .35s ease, opacity .35s ease, border-color .35s ease';
      row.style.background = on ? pal['--chip'] : pal['--ground'];
      row.style.borderLeftColor = on ? pal['--amber'] : past ? pal['--line'] : 'transparent';
      row.style.opacity = on ? '1' : past ? '.5' : '.72';
    });
  }

  private layoutGraphs() {
    this.graphs.forEach((svg) => {
      const host = svg.parentElement;
      if (!host) return;
      const hb = host.getBoundingClientRect();
      if (!hb.width || !hb.height) return;
      const box: Record<string, { l: number; t: number; r: number; b: number; cx: number; cy: number }> = {};
      // The stage graph's nodes animate in with a transform (translate + scale),
      // and getBoundingClientRect() includes transforms, so measuring a node
      // that is still "off" would route its connector to the displaced box.
      // Use the untransformed layout box for that graph (the host is the
      // positioned offset parent); the hero graph keeps the rect measurement.
      const useLayoutBox = svg.getAttribute('data-graph') === 'stage';
      host.querySelectorAll<HTMLElement>('[data-gnode]').forEach((n) => {
        let l: number, t: number, w: number, h: number;
        if (useLayoutBox && n.offsetParent === host) {
          l = n.offsetLeft;
          t = n.offsetTop;
          w = n.offsetWidth;
          h = n.offsetHeight;
        } else {
          const r = n.getBoundingClientRect();
          l = r.left - hb.left;
          t = r.top - hb.top;
          w = r.width;
          h = r.height;
        }
        box[n.getAttribute('data-gnode')!] = { l, t, r: l + w, b: t + h, cx: l + w / 2, cy: t + h / 2 };
      });
      svg.querySelectorAll<SVGPathElement & { __len?: number; __drawn?: boolean }>('path[data-from]').forEach((p) => {
        const a = box[p.getAttribute('data-from')!];
        const b = box[p.getAttribute('data-to')!];
        if (!a || !b) return;
        let d: string;
        const lim = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
        if (svg.getAttribute('data-graph') === 'stage') {
          // "How it works" canvas: the workspace's connector — straight
          // orthogonal runs with square corners, ending exactly on the node's
          // border (the chevron is positioned separately, see below).
          const r1 = (v: number) => Math.round(v * 2) / 2;
          const right = p.getAttribute('data-route') === 'right';
          let ex: number, ey: number;
          if (right) {
            const sx = r1(a.r), sy = r1(a.cy);
            ex = r1(b.l); ey = r1(b.cy);
            const mx = r1((sx + ex) / 2);
            d = Math.abs(ey - sy) < 1 ? 'M' + sx + ' ' + sy + ' H' + ex : 'M' + sx + ' ' + sy + ' H' + mx + ' V' + ey + ' H' + ex;
          } else {
            const sx = r1(a.cx), sy = r1(a.b);
            ex = r1(b.cx); ey = r1(b.t);
            const my = r1((sy + ey) / 2);
            d = Math.abs(ex - sx) < 1 ? 'M' + sx + ' ' + sy + ' V' + ey : 'M' + sx + ' ' + sy + ' V' + my + ' H' + ex + ' V' + ey;
          }
          const tip = svg.querySelector<SVGPathElement>('path[data-tip="' + p.getAttribute('data-edge') + '"]');
          if (tip) tip.setAttribute('transform', 'translate(' + ex + ' ' + ey + ') rotate(' + (right ? 0 : 90) + ')');
        } else if (p.getAttribute('data-route') === 'right') {
          const sx = a.r, sy = a.cy, ex = b.l - 1, ey = b.cy;
          const k = lim(Math.abs(ex - sx) * 0.5, 14, 80);
          const bow = Math.abs(ey - sy) < 14 ? -16 : 0;
          d = 'M' + sx + ' ' + sy + ' C' + (sx + k) + ' ' + (sy + bow) + ' ' + (ex - k) + ' ' + (ey + bow) + ' ' + ex + ' ' + ey;
        } else {
          const sx = a.cx, sy = a.b, ex = b.cx, ey = b.t - 1;
          const k = lim(Math.abs(ey - sy) * 0.5, 10, 70);
          const bow = Math.abs(ex - sx) < 14 ? 18 : 0;
          d = 'M' + sx + ' ' + sy + ' C' + (sx + bow) + ' ' + (sy + k) + ' ' + (ex + bow) + ' ' + (ey - k) + ' ' + ex + ' ' + ey;
        }
        p.setAttribute('d', d);
        const len = p.getTotalLength ? p.getTotalLength() : 200;
        p.__len = len;
        if (svg.getAttribute('data-graph') === 'stage') {
          // A resize changes the path length; apply the new dash values with
          // the CSS transition suspended so the line doesn't visibly re-draw.
          const sp = p as SVGPathElement & { __on?: boolean };
          sp.style.transition = 'none';
          sp.style.strokeDasharray = String(len);
          sp.style.strokeDashoffset = sp.__on === false ? String(len) : '0';
          void sp.getBoundingClientRect();
          sp.style.transition = '';
          return;
        }
        p.style.strokeDasharray = String(len);
        if (svg.getAttribute('data-graph') === 'hero') {
          if (p.__drawn) {
            p.style.strokeDashoffset = '0';
            return;
          }
          p.__drawn = true;
          p.style.strokeDashoffset = String(len);
          p.style.transition = 'stroke-dashoffset 1.2s cubic-bezier(.22,.7,.3,1) ' + (parseInt(p.getAttribute('data-delay') || '0', 10) || 0) + 'ms';
          requestAnimationFrame(() => {
            p.style.strokeDashoffset = '0';
          });
        }
      });
    });
  }

  private paint(el: HTMLElement, theme: Band) {
    const p = PALETTES[theme];
    el.style.transition = el.style.transition || 'background .5s ease, color .5s ease';
    for (const k in p) el.style.setProperty(k, p[k]);
    el.style.background = p['--ground'];
    el.style.color = p['--ink'];
    el.setAttribute('data-theme-now', theme);
  }

  // Paints each seam's two flat panels for the current mode. The "to"
  // panel's clip-path (the actual wipe reveal) is driven separately, every
  // frame, by seamFrame() — this only sets the two solid colors it wipes
  // between.
  private paintSeams(mode: ThemeMode) {
    this.seams.forEach((s) => {
      const parts = (s.getAttribute('data-seam') || '').split(':') as [Band, Band];
      const from = PALETTES[mode === 'scroll' ? parts[0] : mode];
      const to = PALETTES[mode === 'scroll' ? parts[1] : mode];
      const fromEl = s.querySelector<HTMLElement>('[data-seam-panel="from"]');
      const toEl = s.querySelector<HTMLElement>('[data-seam-panel="to"]');
      if (fromEl) fromEl.style.background = from['--ground'];
      if (toEl) toEl.style.background = to['--ground'];
    });
  }

  // A hard-edged wipe, scrubbed by scroll position, replacing the old
  // fixed-duration gradient blend. Progress is measured the same way
  // navTheme() measures which band is "current" — how far the seam has
  // scrolled past a reference line just under the nav — rather than a new
  // technique, so the wipe and the nav's own theme swap stay in lockstep.
  private seamFrame(motion: boolean) {
    const y = (this.nav ? this.nav.getBoundingClientRect().bottom : 66) + 4;
    this.seams.forEach((s) => {
      const to = s.querySelector<HTMLElement>('[data-seam-panel="to"]');
      if (!to) return;
      to.style.transition = '';
      if (this.mode !== 'scroll') {
        // Explicit dark/light mode: from and to already resolve to the
        // same flat color, so the wipe is moot — just leave it fully
        // revealed and skip the per-frame math.
        to.style.clipPath = 'inset(0 0 0% 0)';
        return;
      }
      const rect = s.getBoundingClientRect();
      const raw = clamp01((y - rect.top) / Math.max(1, rect.height));
      if (!motion) {
        to.style.clipPath = raw >= 0.5 ? 'inset(0 0 0% 0)' : 'inset(0 0 100% 0)';
        return;
      }
      const eased = easeInOutCubic(raw);
      to.style.transition = 'clip-path .08s linear';
      to.style.clipPath = 'inset(0 0 ' + ((1 - eased) * 100).toFixed(2) + '% 0)';
    });
  }

  applyMode() {
    const mode = this.mode;
    this.bands.forEach((b) => {
      const natural = (b.getAttribute('data-band') as Band) || 'dark';
      this.paint(b, mode === 'scroll' ? natural : (mode as Band));
    });
    this.paintSeams(mode);
    if (this.root) this.paint(this.root, mode === 'scroll' ? 'dark' : (mode as Band));
    const pal = PALETTES[mode === 'scroll' ? 'dark' : (mode as Band)];
    this.segBtns.forEach((btn) => {
      const on = btn.getAttribute('data-seg-btn') === mode;
      btn.style.background = on ? pal['--accent'] : 'transparent';
      btn.style.color = on ? pal['--on-accent'] : 'inherit';
      btn.style.opacity = on ? '1' : '.8';
    });
  }

  setMode(mode: ThemeMode) {
    this.mode = mode;
    this.applyMode();
    // applyMode() repaints bands/seams/root/segBtns, but nav/cta/seg/github
    // only repaint inside frame()'s nav-theme-change branch — force that
    // branch to run now instead of waiting for the next scroll event.
    this.navNow = null;
    this.frame();
  }

  private primeReveals() {
    if (!this.motionOn() || !('IntersectionObserver' in window)) return;
    this.reveals.forEach((el) => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(22px)';
      el.style.transition = 'opacity .7s cubic-bezier(.16,.84,.3,1), transform .7s cubic-bezier(.16,.84,.3,1)';
    });
    this.io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            (e.target as HTMLElement).style.opacity = '1';
            (e.target as HTMLElement).style.transform = 'none';
            this.io!.unobserve(e.target);
          }
        });
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.12 }
    );
    this.reveals.forEach((el) => this.io!.observe(el));
  }

  private navTheme(): Band {
    if (this.mode !== 'scroll') return this.mode;
    const y = (this.nav ? this.nav.getBoundingClientRect().bottom : 66) + 4;
    let theme: Band = 'dark';
    this.bands.forEach((b) => {
      const r = b.getBoundingClientRect();
      if (r.top <= y && r.bottom > y) theme = (b.getAttribute('data-band') as Band) || 'dark';
    });
    return theme;
  }

  private frame() {
    if (!this.root || !this.root.isConnected) {
      if (!this.collect()) return;
      this.navNow = null;
      this.applyMode();
      this.layoutGraphs();
    }
    const motion = this.motionOn();

    const nt = this.navTheme();
    if (this.nav && nt !== this.navNow) {
      const p = PALETTES[nt];
      this.nav.style.transition = 'background .5s ease, border-color .5s ease, color .5s ease';
      this.nav.style.background = nt === 'dark' ? 'rgba(16,17,20,.82)' : 'rgba(245,245,246,.86)';
      this.nav.style.borderBottomColor = p['--line'];
      this.nav.style.color = p['--ink'];
      if (this.cta) {
        this.cta.style.transition = 'background .5s ease';
        this.cta.style.background = p['--accent'];
      }
      if (this.seg) {
        this.seg.style.transition = this.seg.style.transition || 'border-color .5s ease';
        this.seg.style.borderColor = p['--line'];
      }
      if (this.githubLink) {
        this.githubLink.style.transition = this.githubLink.style.transition || 'color .5s ease, border-color .5s ease';
        this.githubLink.style.color = p['--ink'];
        this.githubLink.style.borderColor = p['--line'];
      }
      this.navNow = nt;
    }

    this.seamFrame(motion);

    if (motion) {
      const sy = window.pageYOffset || document.documentElement.scrollTop || 0;
      const scale = this.parallaxScale();
      this.parallax.forEach((el) => {
        const f = parseFloat(el.getAttribute('data-parallax') || '0') || 0;
        el.style.transform = 'translate3d(0,' + (sy * f * scale).toFixed(2) + 'px,0)';
      });
    }

    this.limitFrame(motion);

    if (!this.stageSection || !this.stages.length) return;
    const rect = this.stageSection.getBoundingClientRect();
    const span = Math.max(1, this.stageSection.offsetHeight - this.viewportHeight());
    const p = clamp01(-rect.top / span);

    if (this.bar) this.bar.style.width = (p * 100).toFixed(2) + '%';

    const seg = p * 3;
    const idx = Math.min(2, Math.floor(seg));
    const local = clamp01(seg - idx);

    this.stages.forEach((el, i) => {
      const on = i === idx;
      const near = !on && Math.abs(i - idx) === 1 ? clamp01(i < idx ? local : 1 - local) : 0;
      el.style.opacity = on ? '1' : String(near * 0.35);
      el.style.transform = on ? 'none' : 'translateY(' + (i < idx ? -14 : 14) + 'px) scale(' + (0.985 + near * 0.015) + ')';
      el.style.transition = 'opacity .6s cubic-bezier(.22,.7,.3,1), transform .6s cubic-bezier(.22,.7,.3,1)';
      el.style.pointerEvents = on ? 'auto' : 'none';
      el.style.zIndex = on ? '2' : '1';
    });

    this.steps.forEach((el, i) => {
      const on = i === idx;
      const bandEl = el.closest<HTMLElement>('[data-band]');
      const pal = PALETTES[(bandEl?.getAttribute('data-theme-now') as Band) || 'light'];
      el.style.background = on ? pal['--chip'] : pal['--ground'];
      el.style.borderLeft = '2px solid ' + (on ? pal['--accent'] : 'transparent');
      el.style.opacity = on ? '1' : '.55';
      el.style.transition = 'opacity .35s ease, background .35s ease';
    });

    const reveal = (list: HTMLElement[], amount: number) => {
      const n = Math.round(list.length * clamp01(amount));
      list.forEach((el, i) => {
        const on = i < n;
        el.style.opacity = on ? '1' : '0';
        el.style.transform = on ? 'none' : 'translateY(6px)';
        el.style.transition = 'opacity .28s ease, transform .28s ease';
      });
    };

    // The stage-0 canvas is state-driven, not scroll-scrubbed: each node and
    // connector flips on once the stage's progress passes its own `data-at`
    // threshold, and CSS (marketing-v2.css) eases the change over time. That
    // way a single mouse-wheel notch still plays a smooth, complete
    // animation instead of jumping the drawing forward in one frame.
    const stageDone = !motion || idx > 0;
    const switchOn = (el: Element) => stageDone || local >= (parseFloat(el.getAttribute('data-at') || '0') || 0);
    this.nodes.forEach((el) => el.setAttribute('data-on', String(switchOn(el))));
    this.edges.forEach((e, i) => {
      const on = switchOn(e);
      e.__on = on;
      e.style.strokeDashoffset = on ? '0' : String(e.__len || 200);
      this.tips[i]?.setAttribute('data-on', String(on));
    });

    if (!motion) {
      reveal(this.codeLines, 1);
      reveal(this.logLines, 1);
      return;
    }

    reveal(this.codeLines, idx > 1 ? 1 : idx < 1 ? 0 : 0.1 + local * 1.25);
    reveal(this.logLines, idx < 2 ? 0 : 0.1 + local * 1.3);
  }

  mount() {
    if (!this.collect()) return false;
    this.applyMode();
    this.primeReveals();
    window.addEventListener('scroll', this.tick, { passive: true });
    window.addEventListener('resize', this.relayout);
    window.addEventListener('orientationchange', this.relayout);
    window.visualViewport?.addEventListener('resize', this.relayout);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(this.relayout);
    requestAnimationFrame(this.relayout);
    this.settleTimeout = setTimeout(this.relayout, 400);
    this.frame();
    return true;
  }

  destroy() {
    this.destroyed = true;
    window.removeEventListener('scroll', this.tick);
    window.removeEventListener('resize', this.relayout);
    window.removeEventListener('orientationchange', this.relayout);
    window.visualViewport?.removeEventListener('resize', this.relayout);
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.settleTimeout) clearTimeout(this.settleTimeout);
    this.io?.disconnect();
  }
}
