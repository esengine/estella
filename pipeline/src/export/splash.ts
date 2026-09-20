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

/** Ids the page and the runtime agree on; `es-` so a game's own markup cannot collide. */
const ROOT = 'es-splash';
const BAR = 'es-splash-bar';
const LABEL = 'es-splash-label';

/**
 * The start screen's CSS. `background` matches the page so the fade lands on the
 * same colour the canvas clears to, rather than flashing through to white.
 */
export function splashCss(background: string): string {
  return (
    `#${ROOT}{position:fixed;inset:0;z-index:20;display:flex;flex-direction:column;`
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

/** The start screen's markup — no script of its own, so the page adds no CSP hash. */
export function splashHtml(title: string): string {
  const safe = title.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
  return `<div id="${ROOT}" role="status" aria-live="polite">`
    + `<div class="es-splash-title">${safe}</div>`
    + `<div class="es-splash-track"><div id="${BAR}"></div></div>`
    + `<div id="${LABEL}">${BOOT_STAGES[0].says}…</div>`
    + '</div>';
}

/** What {@link attachSplash} hands the boot sequence. */
export interface Splash {
  /** Mark a stage finished and advance the bar by that stage's weight. */
  reach(stage: BootStage): void;
  /** Fade out and remove. Safe to call twice. */
  done(): void;
}

/**
 * Drive the page's start screen, or nothing when the page has none.
 *
 * A host that predates this (or a playable, which is sized by an SDK container
 * and has no room for one) simply has no element, and boot proceeds untouched —
 * the start screen must never be a thing a boot can fail on.
 */
export function attachSplash(doc: Document = document): Splash | null {
  const root = doc.getElementById(ROOT);
  if (!root) return null;
  const bar = doc.getElementById(BAR);
  const label = doc.getElementById(LABEL);
  let done = 0;
  const seen = new Set<BootStage>();
  return {
    reach(stage) {
      // Idempotent by stage, not additive: a retried leg must not push the bar
      // past what it has actually finished.
      if (seen.has(stage)) return;
      seen.add(stage);
      done += BOOT_STAGES.find((s) => s.id === stage)?.weight ?? 0;
      if (bar) bar.style.width = `${Math.min(100, Math.round((done / BOOT_TOTAL) * 100))}%`;
      const at = BOOT_STAGES.findIndex((s) => s.id === stage);
      const next = BOOT_STAGES[at + 1];
      if (label && next) label.textContent = `${next.says}…`;
    },
    done() {
      if (!root.isConnected) return;
      if (bar) bar.style.width = '100%';
      root.classList.add('es-splash-gone');
      setTimeout(() => root.remove(), 400);
    },
  };
}
