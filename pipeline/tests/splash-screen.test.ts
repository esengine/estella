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
import { BOOT_STAGES, BOOT_PROGRESS_EVENT, FIRST_FRAME_EVENT, PAGE_BACKGROUND, attachSplash, splashCss, splashHtml, splashScript } from '../src/export/splash';
import { IDENT_SECONDS } from '../src/export/splashIdent';

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
    // A page exported before it had a screen carries none; the portal around it
    // still has to be told the game is drawing.
    expect(frames).toBe(1);
    // And a stretch nothing measures is nothing to a page with no screen.
    expect(() => splash.busy('Compiling shaders')).not.toThrow();
  });

  it('weighs the bar as its host says, for a boot shaped unlike that of a web page', () => {
    const doc = mount();
    // Everything inlined: the network's stages are a sliver and the scene's is most of it.
    const splash = attachSplash(doc, { config: 1, scripts: 1, manifest: 1, scene: 1, engine: 8, app: 6, assets: 80, ready: 2 });
    const bar = (): string => doc.getElementById('es-splash-bar')!.style.width;
    for (const stage of ['config', 'scripts', 'manifest', 'scene', 'engine', 'app'] as const) splash.reach(stage);
    expect(bar()).toBe('18%');
    splash.within('assets', 0.5);
    expect(bar()).toBe('58%');
    splash.reach('assets');
    splash.reach('ready');
    expect(bar()).toBe('100%');
  });

  it('shows a stretch nothing measures as alive, and says what it is', () => {
    const doc = mount();
    const splash = attachSplash(doc);
    splash.reach('config');
    const root = doc.getElementById('es-splash')!;
    const label = doc.getElementById('es-splash-label')!;
    const bar = doc.getElementById('es-splash-bar')!.style.width;
    splash.busy();
    // Without words it leaves the stage's own label alone.
    expect(root.classList.contains('es-splash-busy')).toBe(true);
    expect(label.textContent).toBe(`${BOOT_STAGES[1].says}…`);
    splash.busy('Compiling shaders');
    expect(label.textContent).toBe('Compiling shaders…');
    // It is not progress: the bar stays where the stages put it.
    expect(doc.getElementById('es-splash-bar')!.style.width).toBe(bar);
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

describe('the engine’s ident on the start screen', () => {
  const mount = (look?: Parameters<typeof splashHtml>[1]): HTMLElement => {
    document.body.innerHTML = splashHtml('My Game', look).replace(/<script>[\s\S]*<\/script>/, '');
    return document.getElementById('es-splash')!;
  };

  it('is the whole of a start screen that asked for nothing: a canvas over the page and the script that draws on it', () => {
    const html = splashHtml('My Game');
    const root = mount();
    const canvas = root.querySelector('canvas#es-splash-gl')!;
    expect(canvas.getAttribute('aria-label')).toBe('Estella');
    expect(root.querySelector('.es-splash-title')).toBeNull();
    expect(root.textContent).not.toContain('My Game');
    expect(html.endsWith(`<script>${splashScript()}</script>`)).toBe(true);
    expect(splashCss(PAGE_BACKGROUND)).toContain('#es-splash>canvas{position:absolute;inset:0;width:100%;height:100%;}');
  });

  it('keeps the bar and the stage line for the runtime and for a screen reader, out of sight', () => {
    const root = mount();
    const splash = attachSplash(document);
    splash.reach(BOOT_STAGES[0].id);
    expect(document.getElementById('es-splash-bar')!.style.width).not.toBe('');
    expect(document.getElementById('es-splash-label')!.textContent).toBe(`${BOOT_STAGES[1].says}…`);
    expect(root.classList.contains('es-splash-marked')).toBe(true);
    expect(splashCss(PAGE_BACKGROUND)).toMatch(/\.es-splash-marked \.es-splash-track,#es-splash\.es-splash-marked #es-splash-label\{position:absolute;width:1px;height:1px;/);
  });

  it('plays before a game’s own logo, which comes in after it', () => {
    const root = mount({ logo: 'data:image/png;base64,AAAA' });
    expect(root.querySelector('.es-splash-logo')).not.toBeNull();
    expect(root.querySelector('canvas#es-splash-gl')).not.toBeNull();
    expect(splashCss(PAGE_BACKGROUND)).toContain(`animation:es-splash-logo .7s ${IDENT_SECONDS - 0.5}s both`);
  });

  it('is never cut short: the screen holds for its length, or for longer if the project asked for longer', () => {
    expect(mount().getAttribute('data-ident-ms')).toBe(String(IDENT_SECONDS * 1000));
    expect(mount().hasAttribute('data-min-ms')).toBe(false);
    expect(mount({ minMs: 800 }).getAttribute('data-min-ms')).toBe('800');
    expect(mount({ minMs: 6000 }).getAttribute('data-min-ms')).toBe('6000');
  });

  it('holds for the longer of the ident, counted from the page’s start, and the project’s own minimum', async () => {
    const until = Math.round(performance.now()) + 150;
    document.body.innerHTML = `<div id="es-splash" data-min-ms="20" data-ident-ms="${until}"><div class="es-splash-track"><div id="es-splash-bar"></div></div><div id="es-splash-label"></div></div>`;
    attachSplash(document).done();
    await new Promise((r) => setTimeout(r, 60));
    expect(document.getElementById('es-splash')!.classList.contains('es-splash-gone')).toBe(false);
    await new Promise((r) => setTimeout(r, 160));
    expect(document.getElementById('es-splash')!.classList.contains('es-splash-gone')).toBe(true);
  });

  it('lets the game start under it, and says when it has gone and the game is what is on screen', async () => {
    await new Promise((r) => setTimeout(r, 500));
    const flag = (): unknown => (globalThis as Record<string, unknown>).__estellaIdentDone;
    const until = Math.round(performance.now()) + 80;
    document.body.innerHTML = `<div id="es-splash" data-ident-ms="${until}"><div class="es-splash-track"><div id="es-splash-bar"></div></div><div id="es-splash-label"></div></div>`;
    const splash = attachSplash(document);
    expect(flag()).toBe(false);
    splash.done();
    expect(flag()).toBe(false);
    await new Promise((r) => setTimeout(r, 120));
    expect(document.getElementById('es-splash')!.classList.contains('es-splash-gone')).toBe(true);
    expect(flag()).toBe(false);
    await new Promise((r) => setTimeout(r, 420));
    expect(document.getElementById('es-splash')).toBeNull();
    expect(flag()).toBe(true);
    document.body.innerHTML = '';
    (globalThis as Record<string, unknown>).__estellaIdentDone = false;
    attachSplash(document);
    expect(flag()).toBe(true);
  });

  it('says at once that no ident is covering the game when the start screen carries none, and waits for one that does', async () => {
    const flag = (): unknown => (globalThis as Record<string, unknown>).__estellaIdentDone;
    await new Promise((r) => setTimeout(r, 500));
    document.body.innerHTML = splashHtml('My Game', { engineMark: false });
    const plain = attachSplash(document);
    expect(flag()).toBe(true);
    let plainGone = false;
    void plain.gone().then(() => { plainGone = true; });
    await Promise.resolve();
    expect(plainGone).toBe(true);
    const until = Math.round(performance.now()) + 40;
    document.body.innerHTML = `<div id="es-splash" data-ident-ms="${until}"><div class="es-splash-track"><div id="es-splash-bar"></div></div><div id="es-splash-label"></div></div>`;
    const marked = attachSplash(document);
    expect(flag()).toBe(false);
    let markedGone = false;
    void marked.gone().then(() => { markedGone = true; });
    marked.done();
    await new Promise((r) => setTimeout(r, 100));
    expect(markedGone).toBe(false);
    await new Promise((r) => setTimeout(r, 420));
    expect(markedGone).toBe(true);
    expect(flag()).toBe(true);
  });

  it('carries exactly the script its policy is given the hash of', () => {
    const carried = /<script>([\s\S]*)<\/script>$/.exec(splashHtml('My Game'))![1];
    expect(carried).toBe(splashScript());
  });

  it('paints the ident’s opening black on the page itself, so the page has painted something, and leaves the animation to a worker', () => {
    const root = mount();
    const painted: string[] = [];
    const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
    const saved = { getContext: proto.getContext, transfer: proto.transferControlToOffscreen, worker: (globalThis as { Worker?: unknown }).Worker, url: URL.createObjectURL };
    const workers: { posted: unknown[] }[] = [];
    proto.getContext = (kind: string) => (kind === '2d' ? { fillRect: () => { painted.push('page'); } } : null);
    proto.transferControlToOffscreen = () => ({ offscreen: true });
    URL.createObjectURL = () => 'blob:ident';
    (globalThis as { Worker?: unknown }).Worker = class { posted: unknown[] = []; constructor() { workers.push(this); } postMessage(m: unknown) { this.posted.push(m); } terminate() {} };
    try {
      new Function(splashScript())();
      expect(painted).toEqual(['page']);
      expect(workers).toHaveLength(1);
      expect(workers[0]!.posted[0]).toEqual([{ offscreen: true }, false, expect.any(Number)]);
      const canvases = root.querySelectorAll('canvas');
      expect(canvases).toHaveLength(2);
      expect(canvases[0]!.id).toBe('es-splash-gl');
      expect(canvases[1]!.id).toBe('');
    } finally {
      Object.assign(proto, { getContext: saved.getContext, transferControlToOffscreen: saved.transfer });
      (globalThis as { Worker?: unknown }).Worker = saved.worker;
      URL.createObjectURL = saved.url;
    }
  });

  it('does nothing, and throws nothing, where there is no WebGL to draw with', () => {
    mount();
    expect(() => new Function(splashScript())()).not.toThrow();
  });

  it('is gone, canvas, script, styles and hold, from a page that must not carry it', () => {
    const html = splashHtml('My Game', { engineMark: false });
    expect(html).not.toMatch(/<canvas|<script|es-splash-marked|data-min-ms|data-ident-ms/);
    expect(html).toContain('<div class="es-splash-title">My Game</div>');
    expect(splashCss(PAGE_BACKGROUND, false)).not.toMatch(/es-splash-gl|es-splash-marked|>canvas/);
    expect(splashHtml('My Game', { engineMark: false, minMs: 800 })).toContain('data-min-ms="800"');
  });

  it('costs the page a few kilobytes and asks for nothing over the network', () => {
    const cost = (marked: boolean): number => Buffer.byteLength(splashCss(PAGE_BACKGROUND, marked) + splashHtml('My Game', { engineMark: marked }));
    expect(cost(true) - cost(false)).toBeGreaterThan(2000);
    expect(cost(true) - cost(false)).toBeLessThan(6144);
    expect(splashCss(PAGE_BACKGROUND) + splashHtml('My Game')).not.toMatch(/url\(|src=|@import|fetch\(|XMLHttpRequest|importScripts/);
  });

  it('stands aside for a harness that asked for the frame alone: no drawing, and no wait', async () => {
    expect(splashScript()).toContain("if(!c||/[?&]headless/.test(location.search))return;");
    history.replaceState(null, '', '?headless');
    try {
      document.body.innerHTML = '<div id="es-splash" data-ident-ms="400"><div class="es-splash-track"><div id="es-splash-bar"></div></div><div id="es-splash-label"></div></div>';
      attachSplash(document).done();
      expect(document.getElementById('es-splash')!.classList.contains('es-splash-gone')).toBe(true);
    } finally {
      history.replaceState(null, '', location.pathname);
    }
  });

  it('leaves its script to the page that has to order it after something else', () => {
    const html = splashHtml('My Game', { scriptElsewhere: true });
    expect(html).toContain('<canvas id="es-splash-gl"');
    expect(html).not.toContain('<script');
  });

  it('draws one still frame for someone who asked for less motion', () => {
    expect(splashScript()).toMatch(/prefers-reduced-motion:reduce/);
    expect(splashScript()).toMatch(/q\?9:\(Date\.now\(\)-b\)\/1e3/);
    expect(splashScript()).toMatch(/q\|\|\(D\|\|!self\.requestAnimationFrame/);
  });

  it('draws a quarter as often where the GPU is the CPU, so the boot it covers keeps the processor', () => {
    expect(splashScript()).toMatch(/SwiftShader\|llvmpipe\|softpipe\|Software\/i\.test\(g\.getParameter\(I\?I\.UNMASKED_RENDERER_WEBGL:7937\)\)\?66:0/);
    expect(splashScript()).toContain('setTimeout(f,D||16)');
  });
});
