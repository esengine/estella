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
import { BOOT_STAGES, BOOT_PROGRESS_EVENT, FIRST_FRAME_EVENT, attachSplash } from '../src/export/splash';

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
