// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { parseManifest, resolveOrientation, orientationFromDesignResolution } from '../../pipeline/src/project/format';

describe('parseManifest — packaging', () => {
  it('parses a valid packaging section', () => {
    const m = parseManifest({
      name: 'X',
      packaging: {
        platform: 'wechat', config: 'shipping', sourceMaps: false, openFolder: true,
        outDir: { wechat: 'out/wx', web: 'out/web' },
      },
    });
    expect(m.packaging).toEqual({
      platform: 'wechat', config: 'shipping', sourceMaps: false, openFolder: true,
      outDir: { wechat: 'out/wx', web: 'out/web' },
    });
  });

  it('drops invalid config + non-string outDir entries', () => {
    const m = parseManifest({
      name: 'X',
      packaging: { config: 'debug', sourceMaps: 'yes', outDir: { web: 'ok', desktop: 123 } },
    });
    expect(m.packaging).toEqual({ outDir: { web: 'ok' } });
  });

  // The platform id is OPEN: a project can define its own target in
  // .esengine/platforms/, so the manifest parser cannot tell an unknown id from
  // a bad one. It keeps any non-empty string and drops everything else.
  it('keeps an unknown platform id (a project may define one) but drops non-strings', () => {
    expect(parseManifest({ name: 'X', packaging: { platform: 'acme-play' } }).packaging?.platform).toBe('acme-play');
    // An id an older editor wrote migrates to what this one spells: 'native' was
    // one row for both mobile targets, and reopens on the one that builds anywhere.
    expect(parseManifest({ name: 'X', packaging: { platform: 'native' } }).packaging?.platform).toBe('android');
    expect(parseManifest({ name: 'X', packaging: { platform: '' } }).packaging).toBeUndefined();
    expect(parseManifest({ name: 'X', packaging: { platform: 7 } }).packaging).toBeUndefined();
  });

  it('keeps per-platform output dirs for project-defined platforms', () => {
    const m = parseManifest({ name: 'X', packaging: { outDir: { 'acme-play': 'dist-acme', android: 'dist-android' } } });
    expect(m.packaging?.outDir).toEqual({ 'acme-play': 'dist-acme', android: 'dist-android' });
  });

  // The size budget round-trips, keyed like outDir. Caught on a real export: the
  // dialog wrote it to the manifest and the parser — which is a whitelist —
  // dropped it on the way back, so the build was still judged by the platform's
  // limit and the field looked like it did nothing.
  it('parses per-platform size budgets, migrating legacy platform ids', () => {
    const m = parseManifest({
      name: 'X',
      packaging: { sizeBudget: { wechat: 2097152, native: 40 * 1024 * 1024, 'acme-play': 5000 } },
    });
    expect(m.packaging?.sizeBudget).toEqual({
      wechat: 2097152, android: 40 * 1024 * 1024, 'acme-play': 5000,
    });
  });

  it('drops size budgets that could not be judged against', () => {
    // A zero would read as "every build is infinitely over"; absence means the
    // target keeps its own limit, which is the honest state for a bad value.
    const m = parseManifest({
      name: 'X',
      packaging: { sizeBudget: { web: 0, wechat: -1, desktop: 'big', ios: Number.NaN, android: 10 } },
    });
    expect(m.packaging?.sizeBudget).toEqual({ android: 10 });
    expect(parseManifest({ name: 'X', packaging: { sizeBudget: { web: 0 } } }).packaging?.sizeBudget)
      .toBeUndefined();
  });

  it('parses excludeScenes, dropping non-string / empty entries', () => {
    const m = parseManifest({
      name: 'X',
      packaging: { excludeScenes: ['assets/scenes/dev.esscene', '', 7, 'assets/scenes/test.esscene'] },
    });
    expect(m.packaging?.excludeScenes).toEqual(['assets/scenes/dev.esscene', 'assets/scenes/test.esscene']);
    // An empty list is no list.
    expect(parseManifest({ name: 'X', packaging: { excludeScenes: [] } }).packaging).toBeUndefined();
  });

  it('omits packaging when absent', () => {
    expect(parseManifest({ name: 'X' }).packaging).toBeUndefined();
  });

  it('parses per-platform packaging config, dropping unknown fields', () => {
    const m = parseManifest({
      name: 'X',
      packaging: {
        platforms: {
          wechat: { appid: 'wx123', junk: 1 },
          desktop: { appId: 'com.x.y', productName: 'Y', extra: 'z' },
        },
      },
    });
    expect(m.packaging?.platforms).toEqual({
      wechat: { appid: 'wx123' },
      desktop: { appId: 'com.x.y', productName: 'Y' },
    });
  });
});

describe('parseManifest — orientation (unified, project-wide)', () => {
  it('parses a top-level orientation', () => {
    expect(parseManifest({ name: 'X', packaging: { orientation: 'landscape' } }).packaging?.orientation).toBe('landscape');
    expect(parseManifest({ name: 'X', packaging: { orientation: 'portrait' } }).packaging?.orientation).toBe('portrait');
  });

  it('parses the playable ad network, and drops an empty one', () => {
    expect(parseManifest({ name: 'X', packaging: { platforms: { playable: { network: 'meta' } } } })
      .packaging?.platforms?.playable?.network).toBe('meta');
    // An empty string is not a selection — it must fall through to generic.
    expect(parseManifest({ name: 'X', packaging: { platforms: { playable: { network: '' } } } })
      .packaging?.platforms).toBeUndefined();
  });

  it('drops an invalid top-level orientation', () => {
    expect(parseManifest({ name: 'X', packaging: { orientation: 'diagonal' } }).packaging).toBeUndefined();
  });

  it('migrates a legacy wechat.orientation to the top level, dropping the per-platform field', () => {
    const m = parseManifest({
      name: 'X',
      packaging: { platforms: { wechat: { appid: 'wx1', orientation: 'landscape' } } },
    });
    expect(m.packaging?.orientation).toBe('landscape');
    expect(m.packaging?.platforms).toEqual({ wechat: { appid: 'wx1' } }); // orientation hoisted out
  });

  it('migrates a legacy playable.orientation and drops the (now-empty) playable block', () => {
    const m = parseManifest({
      name: 'X',
      packaging: { platforms: { playable: { orientation: 'portrait' } } },
    });
    expect(m.packaging?.orientation).toBe('portrait');
    expect(m.packaging?.platforms).toBeUndefined(); // playable had only orientation → gone
  });

  it('prefers an explicit top-level orientation over a legacy per-platform one', () => {
    const m = parseManifest({
      name: 'X',
      packaging: { orientation: 'portrait', platforms: { wechat: { orientation: 'landscape' } } },
    });
    expect(m.packaging?.orientation).toBe('portrait');
  });

  it('prefers wechat over playable when both legacy fields are present', () => {
    const m = parseManifest({
      name: 'X',
      packaging: { platforms: { wechat: { orientation: 'landscape' }, playable: { orientation: 'portrait' } } },
    });
    expect(m.packaging?.orientation).toBe('landscape');
  });
});

describe('resolveOrientation / orientationFromDesignResolution', () => {
  it('derives orientation from the design resolution aspect', () => {
    expect(orientationFromDesignResolution({ width: 1920, height: 1080 })).toBe('landscape');
    expect(orientationFromDesignResolution({ width: 1080, height: 1920 })).toBe('portrait');
    expect(orientationFromDesignResolution({ width: 800, height: 800 })).toBe('landscape'); // square ⇒ landscape
    expect(orientationFromDesignResolution(undefined)).toBe('landscape'); // engine default 1920×1080
  });

  it('resolves the explicit setting first, else derives from the design resolution', () => {
    expect(resolveOrientation({ packaging: { orientation: 'portrait' }, designResolution: { width: 1920, height: 1080 } })).toBe('portrait');
    expect(resolveOrientation({ designResolution: { width: 1080, height: 1920 } })).toBe('portrait');
    expect(resolveOrientation({ designResolution: { width: 1280, height: 720 } })).toBe('landscape');
    expect(resolveOrientation({})).toBe('landscape'); // no packaging, no design res
  });
});
