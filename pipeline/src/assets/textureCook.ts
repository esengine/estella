// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    textureCook.ts
 * @brief   What one texture becomes when it is compressed — for a build and the editor alike.
 *
 * @details The build and the editor ask for the same bytes: the editor shows a
 *          texture as the game will draw it, and both read and write the same
 *          cook cache, so whichever compresses a texture first pays for it once.
 */
import { readTextureCookSettings } from '../project/importSettings';
import { decodePngImage, encodeRgbaPng, downscaleRgba } from './atlasPacker';
import {
  decideTextureCook, cookIntentDefeated, explainTextureCook, downscaledSize,
  type TextureCookDecision,
} from './textureCookDecision';
import { bleedCutoutColor } from './modelImages';
import { halveRgba, joinMipLevels, alphaCoverage, preserveAlphaCoverage } from './ktx2Mips';
import { cookCachedAt, cookCacheFile, cookCacheHitAt, encoderIdentity } from './cookCache';

/** Targets the KTX2 the cook emits can transcode to at runtime (UASTC + ETC1S). */
export const COMPRESSED_TARGETS = ['astc-4x4', 'etc2-rgba8', 's3tc-dxt5'];

/** The slice of the vendored Basis encoder (build-tools/basis/encoder.mjs, a JS
 *  module) the cook uses. Typed locally so the per-texture format/srgb path stays
 *  type-checked without a hand-written `.d.ts`. */
export interface BasisEncoderModule {
  encodePngToKtx2(png: Uint8Array, opts?: { mode?: string; srgb?: boolean }): Promise<Uint8Array>;
  encodeToKtx2(
    source: { type: string; data: Uint8Array; width?: number; height?: number },
    opts?: {
      mode?: string; srgb?: boolean; mipmaps?: boolean; yFlip?: boolean;
      supercompress?: boolean; uastcLevel?: number;
    },
  ): Promise<Uint8Array>;
  transcodeKtx2ToRgba(ktx2: Uint8Array): Promise<{ width: number; height: number; pixels: Uint8Array }>;
  ImageType: { PNG: string; JPG: string; RGBA: string };
  ENCODER_WASM: string;
  ENCODER_PARALLELISM: number;
}

/**
 * A cutout's UASTC chain, each level halved here from the one above with its alpha rescaled to the full image's coverage at @p cutoff:
 * the shaders cut every level at the cutoff (glTF's MASK), and plain averaging thins a sparse cutout, such as a railing, until nothing
 * of it passes the cut.
 */
async function encodeCoverageChain(enc: BasisEncoderModule, img: { rgba: Uint8Array; width: number; height: number },
                                   srgb: boolean, cutoff: number): Promise<Uint8Array> {
  const coverage = alphaCoverage(img.rgba, cutoff);
  const parts: Uint8Array[] = [];
  let level = img;
  for (;;) {
    parts.push(await enc.encodeToKtx2({ type: enc.ImageType.RGBA, data: level.rgba, width: level.width, height: level.height },
      { mode: 'uastc', srgb, mipmaps: false, supercompress: true }));
    if (level.width === 1 && level.height === 1) break;
    const half = halveRgba(level.rgba, level.width, level.height, srgb);
    preserveAlphaCoverage(half.rgba, cutoff, coverage);
    level = half;
  }
  return joinMipLevels(parts);
}

/** A loaded encoder and the identity its outputs are cached under. */
export interface TextureEncoder {
  module: BasisEncoderModule;
  id: string;
}

let encoder: Promise<TextureEncoder> | null = null;

/** The vendored Basis encoder, loaded once. By dynamic import, so the Electron-main
 *  bundle keeps it external rather than inlining a module that resolves its wasm
 *  via import.meta.url. */
export function loadTextureEncoder(): Promise<TextureEncoder> {
  encoder ??= (import('../../../build-tools/basis/encoder.mjs') as Promise<unknown>).then((m) => {
    const module = m as BasisEncoderModule;
    return { module, id: encoderIdentity(module.ENCODER_WASM) };
  });
  return encoder;
}

/** PNG width/height from the IHDR (big-endian u32 at byte offsets 16 / 20) —
 *  a header peek, so the `maxSize` cap can skip decoding textures already in range. */
export function pngDimensions(png: Uint8Array): { width: number; height: number } {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

/**
 * A colour image's clear texels filled from their solid neighbours — the rule
 * every cooked image follows (a texture on its own, and an atlas page whose gaps
 * between frames are clear too). `null` when there is nothing to do: no clear
 * texel, or premultiplied art (see {@link looksPremultiplied}).
 */
export function fillClearTexels(image: { rgba: Uint8Array; width: number; height: number }): Uint8Array | null {
  if (!hasClearTexel(image.rgba) || looksPremultiplied(image.rgba)) return null;
  return bleedCutoutColor({ width: image.width, height: image.height, rgba: image.rgba }, { clearOnly: true });
}

/** Whether an importer lets its clear texels be filled: a colour image that has not said no. */
export function fillsClearTexels(importer: Record<string, unknown> | undefined, platform?: string): boolean {
  return readTextureCookSettings(importer, platform).srgb && importer?.alphaIsTransparency !== false;
}

/**
 * Whether a PNG can hold a transparent texel, from its header: grey+alpha or RGBA,
 * or a palette with a tRNS chunk. Answered without decoding, so an opaque image
 * costs nothing here.
 */
export function pngMayHaveAlpha(png: Uint8Array): boolean {
  if (png.byteLength < 26) return false;
  const colorType = png[25];
  if (colorType === 4 || colorType === 6) return true;
  if (colorType !== 3) return false;
  // tRNS precedes IDAT; walk the chunks up to the first image data.
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  for (let at = 8; at + 8 <= png.byteLength;) {
    const len = dv.getUint32(at);
    const type = String.fromCharCode(png[at + 4]!, png[at + 5]!, png[at + 6]!, png[at + 7]!);
    if (type === 'tRNS') return true;
    if (type === 'IDAT') return false;
    at += 12 + len;
  }
  return false;
}

function hasClearTexel(rgba: Uint8Array): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] === 0) return true;
  return false;
}

/**
 * Whether the colour was multiplied by alpha already (a Spine PMA page): no channel
 * above its texel's alpha anywhere, partly clear texels included. Such an image's RGB under alpha 0 is 0 BY
 * DEFINITION, and premultiplied blending adds it — filling it in would light up
 * every clear texel.
 */
function looksPremultiplied(rgba: Uint8Array): boolean {
  // Only partly clear texels can tell the two apart: an opaque texel and a clear
  // one read the same either way. Art with none of them (solid frames on a clear
  // page, pixel art) is straight; a PMA page has an anti-aliased edge somewhere.
  let partial = false;
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3]!;
    if (rgba[i]! > a || rgba[i + 1]! > a || rgba[i + 2]! > a) return false;
    if (a > 0 && a < 255) partial = true;
  }
  return partial;
}

/** Bits a channel a PNG holds (1 to 16), from its header; 8 for anything that is not a PNG. */
export function pngBitDepth(png: Uint8Array): number {
  return png.byteLength > 24 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47 ? png[24]! : 8;
}

function safePngDimensions(png: Uint8Array): { width: number; height: number } | null {
  try {
    return pngDimensions(png);
  } catch {
    return null;
  }
}

export interface TextureCookInput {
  root: string;
  /** Project-relative path, for messages. */
  path: string;
  /** The source file's bytes. */
  data: Uint8Array;
  /** The source's extension, with its dot. */
  ext: string;
  importer?: Record<string, unknown>;
  platform?: string;
  /** Null when this cook compresses nothing — the decision is still taken. */
  encoder: TextureEncoder | null;
  compressTextures: boolean;
  /** Apply authored Max Size while shipping raw PNGs, without a KTX2 encoder. */
  resizeTextures?: boolean;
  atlasTextures: boolean;
  /** A mesh draws this texture (texturesDrawnIn3D) — what Auto compression resolves by. */
  drawnIn3D: boolean;
  /** Answer only from the cook cache: an encode it would have to run is left
   *  undone, and the output says `pending` instead. */
  cachedOnly?: boolean;
}

export interface TextureCookOutput {
  data: Uint8Array;
  ext: string;
  cook: TextureCookDecision;
  /** GPU formats the output transcodes to, when it is compressed. */
  compressedFormats?: string[];
  warnings: string[];
  /** Asked to compress, and its source format is one the encoder does not take. */
  defeatedByFormat: boolean;
  /** `cachedOnly`, and the encode this texture asks for has not been run. */
  pending?: boolean;
  /** The cook-cache file the compressed output is kept in. */
  cacheFile?: string;
}

/**
 * One texture as a build ships it: capped at its `maxSize`, then compressed to
 * KTX2 where its Compression and the build ask for it.
 * Encodes go through the cook cache under the source bytes, the settings that
 * shape the output and the encoder's identity.
 */
export async function cookTexture(input: TextureCookInput): Promise<TextureCookOutput> {
  const { root, path, platform } = input;
  let { data, ext } = input;
  const warnings: string[] = [];
  const tex = readTextureCookSettings(input.importer, platform);
  const raster = ext.toLowerCase() === '.png';
  const textureEnc = input.encoder?.module ?? null;
  // maxSize downscale first — it applies even when a texture opts OUT of
  // compression (a huge UI sprite can ship as a smaller raw PNG), and the
  // ENCODED size is what block alignment is judged on.
  // A PNG of 16 bits a channel is numbers, not a picture: a heightmap, a field of measured values. Shrinking, filling and encoding all
  // decode to 8 bits first, so a build would ship 256 steps where the file holds 65536, a size smaller, and say nothing. It ships as it is.
  if (raster && pngBitDepth(data) === 16) {
    const cook = decideTextureCook({
      compressTextures: input.compressTextures, atlasTextures: input.atlasTextures, inAtlas: false, raster,
      compress: 'off', drawnIn3D: input.drawnIn3D, format: tex.format, size: safePngDimensions(data),
    });
    return { data, ext, cook, warnings, defeatedByFormat: false };
  }
  const sourceSize = raster ? safePngDimensions(data) : null;
  const scaled = !!((textureEnc || input.resizeTextures) && sourceSize && tex.maxSize > 0 &&
    tex.maxSize < Math.max(sourceSize.width, sourceSize.height));
  const size = scaled ? downscaledSize(sourceSize!.width, sourceSize!.height, tex.maxSize) : sourceSize;
  const scaledImage = () => downscaleRgba(decodePngImage(path, data), tex.maxSize);
  const cook = decideTextureCook({
    compressTextures: input.compressTextures, atlasTextures: input.atlasTextures, inAtlas: false, raster,
    compress: tex.compress, drawnIn3D: input.drawnIn3D, format: tex.format, size,
  });
  let defeatedByFormat = false;
  if (cookIntentDefeated(cook)) {
    // A source format the encoder does not take is a property of the whole
    // project's art, not of one asset — the caller summarizes it once.
    if (cook.reason === 'not-raster') defeatedByFormat = true;
    else warnings.push(`${path}: ${explainTextureCook(cook, size)}`);
  }
  // A cutout (one that asks for its coverage kept) has the colour of its solid texels carried into its clear ones, as a model's cutouts do: what a
  // painter leaves under alpha 0 is a mip's, and a filter's, to average in with the leaf, and the edge of every leaf shows it as a halo.
  const cutout = raster && tex.mipmaps && tex.mipCoverage > 0;
  // Any other colour image with clear texels gets the same treatment, held to
  // those texels alone (Unity's "alpha is transparency"): the RGB an editor leaves
  // under alpha 0 is usually black, and a bilinear sample or a mip at the edge of a
  // rounded panel averages it in as a dark fringe. A partly clear texel keeps its
  // colour — on a straight-alpha image it is the colour that is seen.
  // The importer can say no (`alphaIsTransparency: false`): an image whose RGB under
  // alpha 0 a shader reads as data.
  const clearBleed = raster && !cutout && fillsClearTexels(input.importer, platform) && pngMayHaveAlpha(data);
  const bled = (image: { rgba: Uint8Array; width: number; height: number }) => {
    if (cutout) return { ...image, rgba: bleedCutoutColor({ width: image.width, height: image.height, rgba: image.rgba }) };
    const filled = clearBleed ? fillClearTexels(image) : null;
    return filled ? { ...image, rgba: filled } : image;
  };
  const bleedKey = cutout ? { bleed: 1 } : clearBleed ? { bleed: 'clear' } : {};
  // A texture that ships as an image ships the shrunk one, and the bled one —
  // through the cook cache, so the editor shows the same pixels a build ships.
  if (cook.selected === 'raw' && (scaled || cutout || clearBleed)) {
    const source = data;
    const key = [source, JSON.stringify({ raw: 1, maxSize: tex.maxSize, scaled: scaled ? [size!.width, size!.height] : null, ...bleedKey })];
    const file = cookCacheFile(root, key);
    const produce = async (): Promise<Uint8Array> => {
      const decoded = scaled ? scaledImage() : decodePngImage(path, source);
      const image = bled(decoded);
      // An image with nothing to change (an RGBA file that is opaque throughout)
      // ships as it is, byte for byte.
      if (!scaled && image === decoded) return source;
      return encodeRgbaPng(image.width, image.height, image.rgba);
    };
    const shipped = input.cachedOnly ? await cookCacheHitAt(file) : (await cookCachedAt(file, produce)).bytes;
    if (!shipped) return { data, ext, cook, warnings, defeatedByFormat, pending: true };
    const unchanged = shipped.byteLength === source.byteLength && Buffer.from(shipped).equals(Buffer.from(source));
    return unchanged ? { data: source, ext, cook, warnings, defeatedByFormat }
      : { data: shipped, ext, cook, warnings, defeatedByFormat, cacheFile: file };
  }
  if (cook.selected !== 'raw') {
    // Only a build that encodes can select an encoding, and that is exactly
    // when the encoder was loaded — an absent one here is a broken invariant
    // and should say so rather than silently ship raw.
    const enc = textureEnc!;
    const mode = cook.selected;
    const source = data;
    const coverage = mode === 'uastc' && tex.mipmaps ? tex.mipCoverage : 0;
    const mips = tex.mipmaps ? {} : { mipmaps: false };
    // UASTC levels ship under zstd — the bytes a project's textures cost to move and to store.
    // ETC1S already carries its own supercompression. Part of the key, so an entry cooked
    // before this existed is re-encoded rather than reused.
    const supercompress = mode === 'uastc';
    const key = [source, JSON.stringify({ mode, srgb: tex.srgb, maxSize: tex.maxSize, scaled: scaled ? [size!.width, size!.height] : null,
      // `chain: 3` marks the rescaled chain that replaced the share-of-coverage one (chain 2): an entry cooked before it is re-encoded.
      ...(coverage ? { mipCoverage: coverage, chain: 3 } : {}), ...bleedKey, ...(supercompress ? { supercompress } : {}), ...mips }), input.encoder!.id];
    const produce = (): Promise<Uint8Array> => {
      const image = scaled ? bled(scaledImage()) : cutout || clearBleed ? bled(decodePngImage(path, source)) : null;
      return coverage
        ? encodeCoverageChain(enc, image ?? decodePngImage(path, source), tex.srgb, coverage)
        : image
          ? enc.encodeToKtx2({ type: enc.ImageType.RGBA, data: image.rgba, width: image.width, height: image.height }, { mode, srgb: tex.srgb, supercompress, ...mips })
          : enc.encodeToKtx2({ type: enc.ImageType.PNG, data: source }, { mode, srgb: tex.srgb, supercompress, ...mips });
    };
    const file = cookCacheFile(root, key);
    const encoded = input.cachedOnly ? await cookCacheHitAt(file) : (await cookCachedAt(file, produce)).bytes;
    if (!encoded) return { data, ext, cook, warnings, defeatedByFormat, pending: true };
    return { data: encoded, ext: '.ktx2', cook, compressedFormats: COMPRESSED_TARGETS, warnings, defeatedByFormat,
      cacheFile: file };
  }
  return { data, ext, cook, warnings, defeatedByFormat };
}
