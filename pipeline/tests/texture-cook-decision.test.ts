// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The build half of a texture's compression story.
 *
 * Every outcome that is not `compressed` names a DIFFERENT thing to change, and
 * the record's whole value is keeping them apart — "compression was lost" sends
 * an author to the wrong dialog four times out of five.
 */
import { describe, it, expect } from 'vitest';
import {
  decideTextureCook, cookIntentDefeated, explainTextureCook,
  type TextureCookInputs,
} from '../src/assets/textureCookDecision';

const base: TextureCookInputs = {
  compressTextures: true,
  atlasTextures: true,
  inAtlas: false,
  raster: true,
  compress: true,
  format: 'uastc',
  size: { width: 64, height: 64 },
};

describe('decideTextureCook', () => {
  it('encodes a PNG that asked for it and fits whole blocks', () => {
    expect(decideTextureCook(base)).toEqual({
      requested: 'uastc', selected: 'uastc', reason: 'compressed',
    });
    expect(decideTextureCook({ ...base, format: 'etc1s' })).toEqual({
      requested: 'etc1s', selected: 'etc1s', reason: 'compressed',
    });
  });

  it('refuses an image that is not whole 4x4 blocks, and calls that the reason', () => {
    const d = decideTextureCook({ ...base, size: { width: 70, height: 70 } });
    expect(d).toEqual({ requested: 'uastc', selected: 'raw', reason: 'not-block-aligned' });
    // The asset asked and did not get it — this one IS a finding.
    expect(cookIntentDefeated(d)).toBe(true);
    expect(explainTextureCook(d, { width: 70, height: 70 })).toContain('70x70');
  });

  it('treats unreadable dimensions as the same refusal — an encoder cannot be handed an unknown shape', () => {
    expect(decideTextureCook({ ...base, size: null }).reason).toBe('not-block-aligned');
  });

  it('opting out is not a defeat: nothing was requested', () => {
    const d = decideTextureCook({ ...base, compress: false });
    expect(d).toEqual({ requested: 'none', selected: 'raw', reason: 'asset-opt-out' });
    expect(cookIntentDefeated(d)).toBe(false);
  });

  it('a build that skips assets is not a defeat either — it is what somebody chose', () => {
    const d = decideTextureCook({ ...base, compressTextures: false, atlasTextures: false });
    expect(d).toEqual({ requested: 'uastc', selected: 'raw', reason: 'build-skips-assets' });
    expect(cookIntentDefeated(d)).toBe(false);
  });

  it('a non-PNG source asked and was silently passed through', () => {
    const d = decideTextureCook({ ...base, raster: false });
    expect(d).toEqual({ requested: 'uastc', selected: 'raw', reason: 'not-raster' });
    expect(cookIntentDefeated(d)).toBe(true);
  });

  describe('atlas frames', () => {
    it('take the page\'s encoding, not their own', () => {
      const d = decideTextureCook({ ...base, inAtlas: true, format: 'etc1s' });
      expect(d).toEqual({ requested: 'etc1s', selected: 'uastc', reason: 'atlas-page' });
      // The row still reads ETC1S and never applied — the case this record exists for.
      expect(cookIntentDefeated(d)).toBe(true);
    });

    it('agree with a frame that asked for what the page does anyway', () => {
      const d = decideTextureCook({ ...base, inAtlas: true });
      expect(d).toEqual({ requested: 'uastc', selected: 'uastc', reason: 'atlas-page' });
      expect(cookIntentDefeated(d)).toBe(false);
    });

    it('ship raw when the build does not encode, and say the page is why', () => {
      const d = decideTextureCook({ ...base, inAtlas: true, compressTextures: false });
      expect(d).toEqual({ requested: 'uastc', selected: 'raw', reason: 'atlas-page' });
    });

    it('are only atlas frames when the build packs atlases', () => {
      expect(decideTextureCook({ ...base, inAtlas: true, atlasTextures: false }).reason)
        .toBe('compressed');
    });
  });

  it('every reason has its own sentence — a shared one is the collapse this prevents', () => {
    const said = new Set<string>();
    for (const d of [
      decideTextureCook(base),
      decideTextureCook({ ...base, compressTextures: false, atlasTextures: false }),
      decideTextureCook({ ...base, compress: false }),
      decideTextureCook({ ...base, inAtlas: true }),
      decideTextureCook({ ...base, size: { width: 70, height: 70 } }),
      decideTextureCook({ ...base, raster: false }),
    ]) said.add(explainTextureCook(d));
    expect(said.size).toBe(6);
  });
});
