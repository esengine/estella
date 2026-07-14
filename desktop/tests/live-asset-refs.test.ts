// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The realm→inspector asset vocabulary boundary. A play-realm snapshot
 *        carries HANDLES in handle-valued asset slots; shipping them raw made
 *        the Game inspector flag a textured Sprite "required but empty" (red).
 *        translateAssetHandles rewrites them to the load paths the realm's own
 *        Assets recorded — and leaves everything it can't name untouched.
 */
import { describe, it, expect } from 'vitest';
import { translateAssetHandles, projectRelative } from '../src/engine/liveAssetRefs';

const resolver = (kind: string, handle: number): string | null =>
  kind === 'texture' && handle === 7 ? 'assets/art/hero.png' : null;

describe('translateAssetHandles', () => {
  it('rewrites a live texture handle to its load path', () => {
    const out = translateAssetHandles(
      [{ type: 'Sprite', data: { texture: 7, layer: 2 } }],
      resolver,
    );
    expect(out[0].data.texture).toBe('assets/art/hero.png');
    expect(out[0].data.layer).toBe(2); // non-asset fields untouched
  });

  it('leaves the empty sentinel (0) and unresolvable handles untouched', () => {
    const out = translateAssetHandles(
      [{ type: 'Sprite', data: { texture: 0, material: 99 } }],
      resolver,
    );
    expect(out[0].data.texture).toBe(0); // genuinely empty stays empty (red is truthful)
    expect(out[0].data.material).toBe(99); // nobody can name it — pass through, no lie
  });

  it('passes components without asset slots through by reference (pure, no churn)', () => {
    const transform = { type: 'Transform', data: { position: { x: 1, y: 2, z: 0 } } };
    const out = translateAssetHandles([transform], resolver);
    expect(out[0].data).toBe(transform.data);
  });

  it('already-string refs (path-valued slots) are never touched', () => {
    const out = translateAssetHandles(
      [{ type: 'Tilemap', data: { source: 'assets/maps/level1.tmj' } }],
      () => 'should-not-be-asked',
    );
    expect(out[0].data.source).toBe('assets/maps/level1.tmj');
  });
});

describe('projectRelative', () => {
  it('strips the realm origin so the editor registry can name the asset', () => {
    expect(projectRelative('estella://project/assets/art/hero.png', 'estella://project'))
      .toBe('assets/art/hero.png');
    expect(projectRelative('estella://project/assets/x.png', 'estella://project/'))
      .toBe('assets/x.png'); // trailing-slash base normalizes
  });

  it('passes through paths from other origins / already-relative paths', () => {
    expect(projectRelative('assets/art/hero.png', 'estella://project')).toBe('assets/art/hero.png');
    expect(projectRelative('https://cdn/x.png', 'estella://project')).toBe('https://cdn/x.png');
  });
});
