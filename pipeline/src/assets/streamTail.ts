// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  streamTail.ts — the small copy of a 3D texture a streamed build ships beside it.
 *
 * Texture streaming starts a mesh's texture small and grows it to what its views need. A build that ships the file alone still makes
 * the game download it whole before the first, small upload; this writes a copy no larger than {@link STREAM_TAIL_EDGE} on a side
 * next to it, in the same format, and the runtime fetches that one first. The full file is fetched only once a view needs more than
 * the copy holds, and a texture nothing comes close to is never fetched whole at all.
 *
 * KTX2 previews reuse the shipped Basis mip levels when available. Other previews are built from the shipped pixels, halved
 * in linear light for a colour texture and directly for data, then written in the same format.
 */
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { extractMipTail, halveRgba, KHR_DF_MODEL_ETC1S, KHR_DF_MODEL_UASTC, readKtx2Layout } from './ktx2Mips';
import { loadTextureEncoder, type BasisEncoderModule } from './textureCook';

/** The longer side of the copy. Texture streaming starts a mesh texture at this. */
export const STREAM_TAIL_EDGE = 256;

export interface StreamTail {
  bytes: Uint8Array;
  ext: string;
  width: number;
  height: number;
  /** The shipped file's size, which the copy stands in for. */
  fullWidth: number;
  fullHeight: number;
}

async function decode(data: Uint8Array, ext: string, enc: BasisEncoderModule | null): Promise<{ width: number; height: number; rgba: Uint8Array } | null> {
  if (ext === '.png') {
    const png = PNG.sync.read(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    return { width: png.width, height: png.height, rgba: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength) };
  }
  if (ext === '.jpg' || ext === '.jpeg') {
    const img = jpeg.decode(data, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
    return { width: img.width, height: img.height, rgba: img.data };
  }
  if (ext === '.ktx2' && enc) {
    const img = await enc.transcodeKtx2ToRgba(data);
    return { width: img.width, height: img.height, rgba: img.pixels };
  }
  return null;
}

/**
 * The small copy of a shipped texture, or null when it is small enough already (no larger than twice the copy: the saving would not
 * pay for a second file) or its format cannot be read here. @p srgb says whether the texels are colour, which decides how they are
 * averaged; a KTX2 says it itself.
 */
export async function makeStreamTail(data: Uint8Array, ext: string, srgb: boolean): Promise<StreamTail | null> {
  const e = ext.toLowerCase();
  const layout = e === '.ktx2' ? readKtx2Layout(data) : null;
  if (e === '.ktx2') {
    if (!layout?.is2D || Math.max(layout.width, layout.height) <= STREAM_TAIL_EDGE * 2) return null;
    if (layout.colorModel !== KHR_DF_MODEL_UASTC && layout.colorModel !== KHR_DF_MODEL_ETC1S) return null;
    const stored = extractMipTail(data, layout, STREAM_TAIL_EDGE);
    if (stored) return { ...stored, ext, fullWidth: layout.width, fullHeight: layout.height };
  }
  const enc = layout ? (await loadTextureEncoder()).module : null;
  const image = await decode(data, e, enc);
  if (!image || Math.max(image.width, image.height) <= STREAM_TAIL_EDGE * 2) return null;
  const colour = layout ? layout.srgb : srgb;
  let level = { rgba: image.rgba, width: image.width, height: image.height };
  while (Math.max(level.width, level.height) > STREAM_TAIL_EDGE) level = halveRgba(level.rgba, level.width, level.height, colour);

  let bytes: Uint8Array;
  if (enc) {
    const uastc = layout?.colorModel === KHR_DF_MODEL_UASTC;
    bytes = await enc.encodeToKtx2({ type: enc.ImageType.RGBA, data: level.rgba, width: level.width, height: level.height },
      { mode: uastc ? 'uastc' : 'etc1s', srgb: colour, mipmaps: true, supercompress: uastc });
  } else if (e === '.png') {
    const png = new PNG({ width: level.width, height: level.height });
    png.data = Buffer.from(level.rgba.buffer, level.rgba.byteOffset, level.rgba.byteLength);
    bytes = new Uint8Array(PNG.sync.write(png));
  } else {
    bytes = new Uint8Array(jpeg.encode({ data: level.rgba, width: level.width, height: level.height }, 90).data);
  }
  return { bytes, ext, width: level.width, height: level.height, fullWidth: image.width, fullHeight: image.height };
}
