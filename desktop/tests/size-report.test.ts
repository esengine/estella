// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a package weighs, and against what.
 *
 * Two claims carry the whole feature, and both are easy to get quietly wrong:
 *
 *   Bytes are attributed by DELIVERY, not by existing. A group the project
 *   marked `remote` is downloaded from a CDN and costs the package nothing, so
 *   counting it would report a build over a limit it is nowhere near — the exact
 *   failure that makes a size report something a developer learns to ignore.
 *
 *   The package and the uploaded file are the SAME content twice. An .apk sits
 *   inside the directory whose files it contains; a playable's zip is an archive
 *   of the html beside it. Counting both doubles the build.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  summarizeBuildFiles, bucketIndexFrom, kindOf, measureBuild, collectBuildFiles,
} from '../electron/sizeReport';
import { resolveSizeBudgets, evaluateSizeBudget, formatBytes, PROJECT_BUDGET_NOTE } from '../src/project/sizeBudget';

const MB = 1024 * 1024;

/** A manifest shaped like the one every export writes: one group per delivery mode. */
const MANIFEST = {
  version: '2.0',
  groups: {
    main: {
      bundleMode: 'local',
      assets: { 'uuid-a': { path: 'assets/hero.png' } },
    },
    levels: {
      bundleMode: 'lazy',
      assets: { 'uuid-b': { path: 'subpackages/levels/assets/level2.png' } },
    },
    dlc: {
      bundleMode: 'remote',
      assets: { 'uuid-c': { path: 'remote/dlc/assets/movie.mp4' } },
    },
  },
};

describe('bucketing by delivery', () => {
  it('attributes each asset to the mode its group ships in', () => {
    const buckets = bucketIndexFrom(MANIFEST);
    expect(buckets.get('assets/hero.png')).toBe('initial');
    expect(buckets.get('subpackages/levels/assets/level2.png')).toBe('lazy');
    expect(buckets.get('remote/dlc/assets/movie.mp4')).toBe('remote');
  });

  it('counts anything the manifest does not claim as initial — the runtime is not optional', () => {
    const report = summarizeBuildFiles([
      { path: 'wasm/engine.wasm', bytes: 900 },
      { path: 'game.js', bytes: 100 },
      { path: 'index.html', bytes: 10 },
    ], { buckets: bucketIndexFrom(MANIFEST) });
    expect(report.initialBytes).toBe(1010);
    expect(report.lazyBytes).toBe(0);
  });

  it('keeps CDN content out of the package, while still reporting it', () => {
    const report = summarizeBuildFiles([
      { path: 'assets/hero.png', bytes: 1000 },
      { path: 'subpackages/levels/assets/level2.png', bytes: 2000 },
      { path: 'remote/dlc/assets/movie.mp4', bytes: 90_000 },
    ], { buckets: bucketIndexFrom(MANIFEST) });
    expect(report.initialBytes).toBe(1000);
    expect(report.lazyBytes).toBe(2000);
    expect(report.packageBytes).toBe(3000);
    expect(report.remoteBytes).toBe(90_000);
    expect(report.totalBytes).toBe(93_000);
    // …and the CDN's 90KB of video is not part of what fills the package.
    expect(report.byKind.find((k) => k.kind === 'video')).toBeUndefined();
  });

  it('drops build intermediates and sourcemaps — neither is downloaded', () => {
    const report = summarizeBuildFiles([
      { path: 'assets.manifest.json', bytes: 5000 },
      { path: 'game.js.map', bytes: 8000 },
      { path: 'game.js', bytes: 100 },
    ]);
    expect(report.totalBytes).toBe(100);
    expect(report.fileCount).toBe(1);
  });
});

describe('composition', () => {
  it('reads emscripten glue as engine, not as the game\'s own scripts', () => {
    expect(kindOf('wasm/estella.js')).toBe('engine');
    expect(kindOf('wasm/estella.wasm')).toBe('engine');
    expect(kindOf('scripts.mjs')).toBe('scripts');
  });

  it('separates scenes from the rest of the JSON', () => {
    expect(kindOf('scenes/level1.json')).toBe('scene');
    expect(kindOf('game.config.json')).toBe('data');
  });

  it('classifies cooked textures whatever the cook renamed them to', () => {
    expect(kindOf('assets/9f8a7c.ktx2')).toBe('texture');
    expect(kindOf('assets/9f8a7c.png')).toBe('texture');
  });

  it('sees through a mini-game packer\'s .bin restaging', () => {
    // WeChat refuses .ktx2, so the export ships it as .ktx2.bin. Filing those
    // bytes under "data" would send a developer looking through their JSON for
    // megabytes that are in their art — caught on a real WeChat export.
    expect(kindOf('assets/pack/tile0.ktx2.bin')).toBe('texture');
    expect(kindOf('assets/voice.mp3.bin')).toBe('audio');
    expect(kindOf('assets/blob.bin')).toBe('data');   // a genuinely opaque blob
  });

  it('ranks kinds by weight and names the largest files', () => {
    const report = summarizeBuildFiles([
      { path: 'assets/a.png', bytes: 300 },
      { path: 'assets/b.png', bytes: 200 },
      { path: 'music.mp3', bytes: 400 },
      { path: 'game.js', bytes: 50 },
    ]);
    expect(report.byKind.map((k) => k.kind)).toEqual(['texture', 'audio', 'scripts']);
    expect(report.byKind[0]).toEqual({ kind: 'texture', bytes: 500, count: 2 });
    expect(report.largest[0].path).toBe('music.mp3');
  });
});

describe('budgets', () => {
  it('judges WeChat against the main package, not the whole build', () => {
    const budgets = resolveSizeBudgets('wechat');
    const report = summarizeBuildFiles([
      { path: 'assets/hero.png', bytes: 3 * MB },
      { path: 'subpackages/levels/assets/level2.png', bytes: 12 * MB },
    ], { buckets: bucketIndexFrom(MANIFEST), budgets });
    const initial = report.verdicts.find((v) => v.budget.scope === 'initial');
    const total = report.verdicts.find((v) => v.budget.scope === 'total');
    expect(initial?.status).toBe('ok');          // 3MB main package, under 4
    expect(total?.status).toBe('ok');            // 15MB all in, under 20
    expect(initial?.budget.note).toMatch(/main package at 4MB/);
    // The 12MB subpackage is over the MAIN package limit and is not judged by
    // it — putting the level behind a subpackage is exactly the fix.
    expect(initial?.measuredBytes).toBe(3 * MB);
  });

  it('reports over-limit by how much, so 1% over does not read like double', () => {
    const report = summarizeBuildFiles([{ path: 'assets/hero.png', bytes: 5 * MB }], {
      budgets: resolveSizeBudgets('wechat'),
    });
    const initial = report.verdicts.find((v) => v.budget.scope === 'initial')!;
    expect(initial.status).toBe('over');
    expect(initial.measuredBytes - initial.budget.maxBytes).toBe(1 * MB);
    expect(initial.ratio).toBeCloseTo(1.25);
  });

  it('warns before the limit rather than at it', () => {
    expect(evaluateSizeBudget(3.7 * MB, { scope: 'initial', maxBytes: 4 * MB, note: '' }).status).toBe('near');
    expect(evaluateSizeBudget(3.5 * MB, { scope: 'initial', maxBytes: 4 * MB, note: '' }).status).toBe('ok');
  });

  it('lets a project replace the platform\'s limit with its own', () => {
    const budgets = resolveSizeBudgets('wechat', { projectMaxBytes: 2 * MB });
    const initial = budgets.find((b) => b.scope === 'initial')!;
    expect(initial.maxBytes).toBe(2 * MB);
    expect(initial.note).toBe(PROJECT_BUDGET_NOTE);
    // The platform's OTHER limit still applies — a project ceiling is not a waiver.
    expect(budgets.find((b) => b.scope === 'total')?.maxBytes).toBe(20 * MB);
  });

  it('gives a target with no limit of its own the project\'s, measured before play', () => {
    const budgets = resolveSizeBudgets('web', { projectMaxBytes: 6 * MB });
    expect(budgets).toEqual([{ scope: 'initial', maxBytes: 6 * MB, note: PROJECT_BUDGET_NOTE }]);
    expect(resolveSizeBudgets('web')).toEqual([]);
  });

  it('prefers a vendor profile\'s limit over the built-in for the same scope', () => {
    const budgets = resolveSizeBudgets('wechat', {
      profile: [{ scope: 'initial', maxBytes: 8 * MB, note: 'this host raised it' }],
    });
    expect(budgets.find((b) => b.scope === 'initial')?.maxBytes).toBe(8 * MB);
    expect(budgets.find((b) => b.scope === 'total')?.maxBytes).toBe(20 * MB);
  });

  it('skips a deliverable limit when no upload file was produced', () => {
    // An Android export that stopped at the content payload: reporting it as
    // comfortably under the limit would be a reassuring lie.
    const report = summarizeBuildFiles([{ path: 'assets/hero.png', bytes: 10 }], {
      budgets: [{ scope: 'deliverable', maxBytes: 2 * MB, note: 'network cap' }],
    });
    expect(report.verdicts).toEqual([]);
  });
});

describe('measuring a build on disk', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'es-size-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  const write = async (rel: string, bytes: number): Promise<void> => {
    const abs = path.join(dir, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, Buffer.alloc(bytes));
  };

  it('walks nested output and reports paths in the shipped shape', async () => {
    await write('wasm/engine.wasm', 64);
    await write('assets/hero.png', 32);
    const files = await collectBuildFiles(dir);
    expect(files.map((f) => f.path).sort()).toEqual(['assets/hero.png', 'wasm/engine.wasm']);
  });

  it('counts the package once when the upload file sits inside it', async () => {
    await write('assets/hero.png', 1000);
    await write('game.js', 500);
    await write('com.estella.game.apk', 1500);   // the same content, packaged
    const report = await measureBuild({
      root: dir,
      platform: 'android',
      deliverable: path.join(dir, 'com.estella.game.apk'),
      packages: [path.join(dir, 'com.estella.game.apk')],
    });
    expect(report.packageBytes).toBe(1500);      // NOT 3000
    expect(report.deliverableBytes).toBe(1500);
    expect(report.deliverableName).toBe('com.estella.game.apk');
  });

  it('measures a desktop app as the directory it is, and counts it once', async () => {
    // A desktop package is a DIRECTORY, and stat() on one reports a few dozen
    // bytes of bookkeeping — so measured as a file it weighs nothing and passes
    // every limit, while its contents are still counted loose beside it.
    await write('assets/hero.png', 1000);
    await write('game.config.json', 20);
    await write('Cool Game/Cool Game.exe', 4000);
    await write('Cool Game/Content/assets/hero.png', 1000);
    await write('Cool Game/Content/game.config.json', 20);
    const app = path.join(dir, 'Cool Game');
    const report = await measureBuild({
      root: dir, platform: 'desktop', deliverable: app, packages: [app],
    });
    expect(report.packageBytes).toBe(1020);        // the loose content only
    expect(report.deliverableBytes).toBe(5020);    // everything inside the app
  });

  it('reads the manifest the export wrote, so buckets agree with the runtime', async () => {
    await write('asset-manifest.json', 0);
    await writeFile(path.join(dir, 'asset-manifest.json'), JSON.stringify(MANIFEST));
    await write('assets/hero.png', 1000);
    await write('remote/dlc/assets/movie.mp4', 50_000);
    const report = await measureBuild({ root: dir, platform: 'web' });
    expect(report.initialBytes).toBe(1000 + report.byKind.reduce((n, k) => k.kind === 'data' ? n + k.bytes : n, 0));
    expect(report.remoteBytes).toBe(50_000);
  });

  it('never fails a build: an output dir that is not there measures as empty', async () => {
    const report = await measureBuild({ root: path.join(dir, 'nope'), platform: 'web' });
    expect(report.fileCount).toBe(0);
    expect(report.packageBytes).toBe(0);
  });
});

describe('one spelling of a byte size', () => {
  it('is binary, and drops the decimal once the number is big enough to not need it', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(4 * MB)).toBe('4.0 MB');
    expect(formatBytes(40 * MB)).toBe('40 MB');
    expect(formatBytes(3 * 1024 * MB)).toBe('3.0 GB');
  });
});
