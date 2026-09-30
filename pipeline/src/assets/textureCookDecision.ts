// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  textureCookDecision.ts
 * @brief What a build does to one texture's compression request, and why.
 *
 *        A texture's compression is decided TWICE, in two lifetimes, and the two
 *        answers are not interchangeable. This is the first: at cook, a build
 *        picks the payload that ships. The second happens per device, at upload,
 *        when that payload becomes a GPU format or is decoded back to RGBA
 *        (sdk/src/asset/compressed.ts). Folding them into one "compression was
 *        lost" tells an author their memory doubled without telling them whether
 *        to change the build target or accept the device.
 *
 *        The cook calls this rather than re-deriving it, so what a build did and
 *        what an inspector predicts are one function with one branch order.
 */
import type { TextureCompression } from '../project/importSettings';

/**
 * What a source image becomes under the import's `maxSize` — the size every
 * later decision is about, block alignment included.
 *
 * Here rather than beside the packer that downsamples: reading it must not cost
 * a PNG decoder, which reached the renderer as a `require('util')` that throws.
 */
export function downscaledSize(
    width: number, height: number, maxDim: number,
): { width: number; height: number } {
    const longest = Math.max(width, height);
    if (!(maxDim > 0) || longest <= maxDim) return { width, height };
    const scale = maxDim / longest;
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    };
}

/** The Basis encoding modes a cooked KTX2 can be written in. */
export type TextureCookFormat = 'uastc' | 'etc1s';

/** What actually ships for a texture: a KTX2 in one of the modes, or the image. */
export type CookedTexturePayload = TextureCookFormat | 'raw';

/**
 * Why the selected payload is what it is.
 *
 * `compressed` is the only outcome that keeps a request; the rest each name a
 * DIFFERENT thing to change — the Build dialog, this asset's Inspector row, its
 * folder, its dimensions, its file format — not one "not compressed".
 */
export type TextureCookReason =
  | 'compressed'
  | 'build-skips-assets'
  | 'asset-opt-out'
  /** Compression is Auto and nothing draws the texture on a mesh: a sprite or UI
   *  image, which ships as its original file. */
  | 'auto-2d'
  | 'atlas-page'
  | 'not-block-aligned'
  | 'not-raster';

export interface TextureCookDecision {
  /** The mode this asset asked for, or `none` when it did not ask to be compressed. */
  readonly requested: TextureCookFormat | 'none';
  readonly selected: CookedTexturePayload;
  readonly reason: TextureCookReason;
}

export interface TextureCookInputs {
  /** The build encodes textures at all (packaging.assetCompression). */
  readonly compressTextures: boolean;
  /** The build packs `<name>.atlas/` folders. */
  readonly atlasTextures: boolean;
  /** This image is a frame of one of those atlases. */
  readonly inAtlas: boolean;
  /** For a frame: whether its page ships compressed — a page is compressed when a
   *  frame on it asks to be, since the page is the one payload they all share. */
  readonly atlasPageCompressed?: boolean;
  /** A source the KTX2 encoder takes — PNG. JPEG/WebP/SVG pass through as-is. */
  readonly raster: boolean;
  /** The asset's own Compression row. */
  readonly compress: TextureCompression;
  /** A mesh draws this texture, directly or through its material — what Auto
   *  resolves by (textureUsage.ts). */
  readonly drawnIn3D: boolean;
  readonly format: TextureCookFormat;
  /**
   * The dimensions that would be ENCODED — after any Max Size downscale, not the
   * source's. Null when they could not be read, which is refused exactly as a
   * misaligned size is: an encoder cannot be handed an image of unknown shape.
   */
  readonly size: { readonly width: number; readonly height: number } | null;
}

/** Block-compressed formats copy whole 4x4 blocks; WebGPU refuses a texture that
 *  is not a whole number of them, so a 70x70 sprite fails CreateTexture and the
 *  game draws nothing. Shipping it raw is the correct outcome, not a workaround. */
function wholeBlocks(size: TextureCookInputs['size']): boolean {
  return size !== null && size.width % 4 === 0 && size.height % 4 === 0;
}

/** The payload a build ships for one texture, and the one reason it is that. */
export function decideTextureCook(input: TextureCookInputs): TextureCookDecision {
  const requested = textureAsksCompression(input.compress, input.drawnIn3D) ? input.format : 'none';
  // An atlas frame has no payload of its own: the PAGE ships, and a page
  // aggregates images whose settings disagree, so it is always UASTC when it is
  // encoded. Recorded rather than assumed — a frame got the page's answer.
  if (input.atlasTextures && input.inAtlas) {
    const encoded = input.compressTextures && input.atlasPageCompressed === true;
    return { requested, selected: encoded ? 'uastc' : 'raw', reason: 'atlas-page' };
  }
  if (!input.compressTextures) return { requested, selected: 'raw', reason: 'build-skips-assets' };
  if (!input.raster) return { requested, selected: 'raw', reason: 'not-raster' };
  if (input.compress === 'off') return { requested, selected: 'raw', reason: 'asset-opt-out' };
  if (requested === 'none') return { requested, selected: 'raw', reason: 'auto-2d' };
  if (!wholeBlocks(input.size)) return { requested, selected: 'raw', reason: 'not-block-aligned' };
  return { requested, selected: input.format, reason: 'compressed' };
}

/**
 * Whether a texture's Compression asks for a KTX2: On does, Off does not, and Auto
 * does for a texture a mesh draws — where video memory is the cost — and not for
 * sprites and UI, where a flat PNG is often a tenth of the KTX2 to download.
 */
export function textureAsksCompression(compress: TextureCompression, drawnIn3D: boolean): boolean {
  return compress === 'on' || (compress === 'auto' && drawnIn3D);
}

/**
 * True when the asset asked for an encoding and the build did not give it.
 *
 * Opting out and a build that skips assets are choices. This catches the silent
 * kind: a request that survived every dialog and lost to the image itself, or to
 * the folder it was dropped in.
 */
export function cookIntentDefeated(d: TextureCookDecision): boolean {
  if (d.requested === 'none') return false;
  if (d.reason === 'build-skips-assets') return false;
  return d.selected !== d.requested;
}

/** One line saying what happened to a request, for a build log. */
export function explainTextureCook(
  d: TextureCookDecision, size?: { width: number; height: number } | null,
): string {
  switch (d.reason) {
    case 'compressed':
      return `compressed to KTX2 (${d.selected})`;
    case 'build-skips-assets':
      return 'shipped raw — this build skips asset optimization';
    case 'asset-opt-out':
      return 'shipped raw — Compression is set to Original image on this asset';
    case 'auto-2d':
      return 'shipped raw — Compression is Auto and no mesh draws this texture';
    case 'atlas-page':
      return d.selected === 'raw'
        ? 'packed into an atlas page, which this build ships raw'
        : `packed into an atlas page, which is encoded ${d.selected} whatever a frame asks for`;
    case 'not-block-aligned':
      return `shipped raw — ${size ? `${size.width}x${size.height}` : 'its size'} `
        + 'is not a multiple of 4, which a block-compressed texture must be';
    case 'not-raster':
      return 'shipped raw — only PNG sources are encoded';
  }
}
