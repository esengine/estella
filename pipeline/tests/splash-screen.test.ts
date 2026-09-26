// @vitest-environment jsdom
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The start screen's own behaviour, which the page's markup only sets up.
 *
 * A file of its own because jsdom is: the export tests next door bundle with
 * esbuild, and a DOM in that process breaks it.
 */
import { describe, it, expect } from 'vitest';
import { BOOT_STAGES, BOOT_PROGRESS_EVENT, FIRST_FRAME_EVENT, attachSplash, splashCodeJs } from '../src/export/splash';

describe('driving the start screen', () => {
  const mount = (attrs = ''): Document => {
    document.body.innerHTML = `<div id="es-splash"${attrs}>`
      + '<div class="es-splash-track"><div id="es-splash-bar"></div></div>'
      + '<div id="es-splash-label"></div></div>';
    return document;
  };

  it('announces every stage it reaches, and never goes backwards', () => {
    const seen: { stage: string; progress: number }[] = [];
    window.addEventListener(BOOT_PROGRESS_EVENT, (e) => seen.push((e as CustomEvent).detail));
    const splash = attachSplash(mount());
    for (const s of BOOT_STAGES) splash.reach(s.id);
    // Re-reaching one must not push the bar past what actually finished.
    splash.reach(BOOT_STAGES[0].id);

    expect(seen.map((s) => s.stage)).toEqual(BOOT_STAGES.map((s) => s.id));
    expect(seen.map((s) => s.progress)).toEqual([...seen.map((s) => s.progress)].sort((a, b) => a - b));
    expect(seen[seen.length - 1].progress).toBe(1);
  });

  it('is moved by the page itself while the code downloads, a script at a time', () => {
    const doc = mount(' data-code-bytes="1000"');
    const view = window as Window & { __esBootCode?: number; __esBootTaken?: boolean; PerformanceObserver?: unknown };
    delete view.__esBootTaken;
    let deliver: (names: [string, number][]) => void = () => {};
    const real = view.PerformanceObserver;
    view.PerformanceObserver = class {
      constructor(cb: (list: { getEntries: () => unknown[] }) => void) {
        deliver = (names) => cb({ getEntries: () => names.map(([name, decodedBodySize]) => ({ name, decodedBodySize })) });
      }
      observe() {}
    };
    const seen: number[] = [];
    const listen = (e: Event) => seen.push((e as CustomEvent).detail.progress);
    window.addEventListener(BOOT_PROGRESS_EVENT, listen);
    try {
      new Function(splashCodeJs())();
      const share = BOOT_STAGES.find((s) => s.id === 'code')!.weight / BOOT_STAGES.reduce((n, s) => n + s.weight, 0);
      deliver([['https://game.example/game.js', 400], ['https://game.example/logo.png', 999]]);
      deliver([['https://game.example/sdk/index.lean.js?v=2', 600], ['https://game.example/game.js', 400]]);
      expect(view.__esBootCode).toBe(1);
      expect(seen.map((p) => +(p / share).toFixed(3))).toEqual([0.4, 1]);
      expect(doc.getElementById('es-splash-bar')!.style.width).toBe(`${Math.round(share * 100)}%`);
    } finally {
      window.removeEventListener(BOOT_PROGRESS_EVENT, listen);
      view.PerformanceObserver = real;
      delete view.__esBootCode;
    }
  });

  it('carries on from where the page moved the bar while the code downloaded', () => {
    const doc = mount();
    const view = window as Window & { __esBootCode?: number; __esBootTaken?: boolean };
    view.__esBootCode = 0.5;
    delete view.__esBootTaken;
    const code = BOOT_STAGES.find((s) => s.id === 'code')!;
    const total = BOOT_STAGES.reduce((n, s) => n + s.weight, 0);
    const bar = doc.getElementById('es-splash-bar')!;
    bar.style.width = `${Math.round(0.5 * (code.weight / total) * 100)}%`;
    const before = bar.style.width;
    const splash = attachSplash(doc);
    expect(view.__esBootTaken).toBe(true);
    // A partial step inside the code stage the page already passed does not pull it back.
    splash.within('code', 0.1);
    expect(bar.style.width).toBe(before);
    splash.reach('code');
    expect(parseInt(bar.style.width, 10)).toBe(Math.round((code.weight / total) * 100));
    delete view.__esBootCode;
  });

  it('says when the first frame is up, even on a page with no start screen', () => {
    document.body.innerHTML = '';
    let frames = 0;
    window.addEventListener(FIRST_FRAME_EVENT, () => { frames += 1; });
    const splash = attachSplash(document);
    splash.done();
    splash.done();
    // A playable is sized by an SDK container and carries no screen; the portal
    // around it still has to be told the game is drawing.
    expect(frames).toBe(1);
  });

  it('holds a fast boot on screen for as long as the project asked', async () => {
    const doc = mount(' data-min-ms="120"');
    const splash = attachSplash(doc);
    splash.done();
    expect(doc.getElementById('es-splash')?.classList.contains('es-splash-gone')).toBe(false);
    await new Promise((r) => setTimeout(r, 200));
    expect(doc.getElementById('es-splash')?.classList.contains('es-splash-gone')).toBe(true);
  });

  it('fades at once when the project asked for no hold', () => {
    const doc = mount();
    attachSplash(doc).done();
    expect(doc.getElementById('es-splash')?.classList.contains('es-splash-gone')).toBe(true);
  });
});
