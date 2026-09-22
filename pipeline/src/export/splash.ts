// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  splash.ts — the exported page's start screen, and the one list of boot
 *        stages it and the runtime both read.
 *
 * The page carries the markup because it has to be on screen before `game.js`
 * is even fetched, and the runtime moves the bar because `boot()` is the only
 * thing that knows which stage it reached. Those are two readers of one list, so
 * the list lives here rather than being spelled once in each.
 *
 * The stage list is the SDK's: a mini-game shows the same progress through a
 * host API rather than an overlay, and two copies would disagree about how far
 * along one boot is.
 */
import { BOOT_STAGES, BOOT_TOTAL, type BootStage } from '../../../sdk/src/runtime/bootStages';

export { BOOT_STAGES, type BootStage };

/**
 * The page's ground, and what the start screen fades out over. One colour for
 * both, or the fade flashes through to white between them — which is why the
 * page and this file cannot each name their own.
 */
export const PAGE_BACKGROUND = '#0e121b';

/** Ids the page and the runtime agree on; `es-` so a game's own markup cannot collide. */
const ROOT = 'es-splash';
const BAR = 'es-splash-bar';
const LABEL = 'es-splash-label';

/** What the project said the start screen should look like. */
export interface SplashLook {
  /** The logo as a data: URI — inlined by the export, since an image fetched
   *  after the engine has nothing left to cover. */
  logo?: string;
  /** Shortest time on screen, in ms. */
  minMs?: number;
  /** CSS colour behind it; the page's own when the project said nothing. */
  background?: string;
}

/**
 * The start screen's CSS. `background` matches the page so the fade lands on the
 * same colour the canvas clears to, rather than flashing through to white.
 */
export function splashCss(background: string): string {
  return (
    `#${ROOT} .es-splash-logo{max-width:min(220px,46vw);max-height:30vh;object-fit:contain;}`
    + `#${ROOT}{position:fixed;inset:0;z-index:20;display:flex;flex-direction:column;`
    + `align-items:center;justify-content:center;gap:18px;background:${background};`
    + "color:#c7d0e0;font:500 14px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;"
    + 'transition:opacity .35s ease;padding:24px;text-align:center;}'
    + `#${ROOT}.es-splash-gone{opacity:0;pointer-events:none;}`
    + `#${ROOT} .es-splash-title{font-size:19px;font-weight:650;letter-spacing:.01em;}`
    + `#${ROOT} .es-splash-track{width:min(260px,62vw);height:3px;border-radius:2px;`
    + 'background:rgba(199,208,224,.18);overflow:hidden;}'
    + `#${ROOT} #${BAR}{height:100%;width:0;border-radius:2px;background:#c7d0e0;`
    + 'transition:width .25s ease;}'
    + `#${ROOT} #${LABEL}{font-size:12px;opacity:.72;min-height:1.5em;}`
    // A start screen that outlives its own boot is worse than none: if the
    // runtime never arrives to fade it, this hides it rather than covering the
    // game forever.
    + `@media (prefers-reduced-motion:reduce){#${ROOT}{transition:none;}}`
  );
}

/** The start screen's markup — no script of its own, so the page adds no CSP hash.
 *  `minMs` rides on a data attribute for the same reason. */
export function splashHtml(title: string, look: SplashLook = {}): string {
  const safe = title.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
  const hold = look.minMs ? ` data-min-ms="${Math.round(look.minMs)}"` : '';
  // A game with a logo shows the logo; the title is then the alt text rather
  // than a second heading saying the same thing.
  const mark = look.logo
    ? `<img class="es-splash-logo" src="${look.logo}" alt="${safe}">`
    : `<div class="es-splash-title">${safe}</div>`;
  return `<div id="${ROOT}" role="status" aria-live="polite"${hold}>`
    + mark
    + `<div class="es-splash-track"><div id="${BAR}"></div></div>`
    + `<div id="${LABEL}">${BOOT_STAGES[0].says}…</div>`
    + '</div>';
}

/** What {@link attachSplash} hands the boot sequence. */
export interface Splash {
  /** Mark a stage finished and advance the bar by that stage's weight. */
  reach(stage: BootStage): void;
  /** How far through a stage that has NOT finished — `0..1` of its own weight.
   *  `engine` alone is 40 of the 100, so a bar that only moves on completion
   *  stands still for most of a cold start. */
  within(stage: BootStage, fraction: number): void;
  /** Fade out and remove. Safe to call twice. */
  done(): void;
}

/**
 * The events a page outside the bundle listens for — a portal SDK's own loading
 * screen. DOM events, not a global: a listener must be added BEFORE the bundle
 * runs, and the page carries no script of ours to define one on. `progress` is
 * 0..1 and never goes backwards; `partial` marks a stage still running.
 */
export const BOOT_PROGRESS_EVENT = 'esengine:bootprogress';
export const FIRST_FRAME_EVENT = 'esengine:firstframe';

/**
 * Drive the page's start screen and announce the boot.
 *
 * Always returns: a playable is sized by an SDK container and carries no start
 * screen, but a portal around it still wants the events. A boot must never be a
 * thing the start screen can fail.
 */
export function attachSplash(doc: Document = document): Splash {
  const root = doc.getElementById(ROOT);
  const bar = root && doc.getElementById(BAR);
  const label = root && doc.getElementById(LABEL);
  const showUntil = Date.now() + Number(root?.getAttribute('data-min-ms') ?? 0);
  let done = 0;
  /** What the bar is showing, so a partial step never pulls it back. */
  let shown = 0;
  let finished = false;
  const seen = new Set<BootStage>();
  const announce = (type: string, detail: unknown): void => {
    const view = doc.defaultView;
    if (view) view.dispatchEvent(new view.CustomEvent(type, { detail }));
  };
  const fade = (): void => {
    if (!root?.isConnected) return;
    root.classList.add('es-splash-gone');
    setTimeout(() => root.remove(), 400);
  };
  /** Never backwards. Answers whether the bar actually moved a whole percent,
   *  which is the only movement worth telling a portal's own screen about. */
  const show = (progress: number): boolean => {
    if (progress <= shown) return false;
    const was = Math.round(shown * 100);
    shown = progress;
    const now = Math.round(progress * 100);
    if (bar) bar.style.width = `${now}%`;
    return now > was;
  };
  return {
    within(stage, fraction) {
      if (seen.has(stage)) return;
      const weight = BOOT_STAGES.find((s) => s.id === stage)?.weight ?? 0;
      const partial = Math.max(0, Math.min(1, fraction)) * weight;
      const progress = Math.min(1, (done + partial) / BOOT_TOTAL);
      // `partial` marks a stage still running, so a listener can tell "40% of
      // the way through fetching the engine" from "the engine is up".
      if (show(progress)) announce(BOOT_PROGRESS_EVENT, { stage, progress, partial: true });
    },
    reach(stage) {
      // Idempotent by stage, not additive: a retried leg must not push the bar
      // past what it has actually finished.
      if (seen.has(stage)) return;
      seen.add(stage);
      done += BOOT_STAGES.find((s) => s.id === stage)?.weight ?? 0;
      const progress = Math.min(1, done / BOOT_TOTAL);
      show(progress);
      const at = BOOT_STAGES.findIndex((s) => s.id === stage);
      const next = BOOT_STAGES[at + 1];
      if (label && next) label.textContent = `${next.says}…`;
      announce(BOOT_PROGRESS_EVENT, { stage, progress });
    },
    done() {
      if (finished) return;
      finished = true;
      show(1);
      announce(FIRST_FRAME_EVENT, {});
      // A boot that finished in 120ms would otherwise flash a bar that appears
      // and vanishes, which reads as a glitch rather than as loading.
      const wait = showUntil - Date.now();
      if (wait > 0) setTimeout(fade, wait);
      else fade();
    },
  };
}
