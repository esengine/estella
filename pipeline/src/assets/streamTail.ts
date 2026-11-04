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
 * The copy is made from the shipped bytes, not the source, so it is the same picture at every size: halved with the same box filter
 * the cook's own mip chains use, linear-light for a colour texture and plain for data. A KTX2 is encoded again in its own mode; a PNG
 * and a JPEG are written as what they were.
 */
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { halveRgba, readKtx2Layout } from './ktx2Mips';
import type { BasisEncoderModule } from './textureCook';

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

const KHR_DF_MODEL_UASTC = 166;

async function decode(data: Uint8Array, ext: string, enc: BasisEncoderModule | null): Promise<{ width: number; height: number; rgba: Uint8Array } | null> {
  const e = ext.toLowerCase();
  if (e === '.png') {
    const png = PNG.sync.read(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    return { width: png.width, height: png.height, rgba: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength) };
  }
  if (e === '.jpg' || e === '.jpeg') {
    const img = jpeg.decode(data, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
    return { width: img.width, height: img.height, rgba: img.data };
  }
  if (e === '.ktx2' && enc) {
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
export async function makeStreamTail(
  data: Uint8Array, ext: string, srgb: boolean, enc: BasisEncoderModule | null,
): Promise<StreamTail | null> {
  const image = await decode(data, ext, enc);
  if (!image || Math.max(image.width, image.height) <= STREAM_TAIL_EDGE * 2) return null;
  const layout = ext.toLowerCase() === '.ktx2' ? readKtx2Layout(data) : null;
  const colour = layout ? layout.srgb : srgb;
  let level = { rgba: image.rgba, width: image.width, height: image.height };
  while (Math.max(level.width, level.height) > STREAM_TAIL_EDGE) level = halveRgba(level.rgba, level.width, level.height, colour);

  const e = ext.toLowerCase();
  let bytes: Uint8Array;
  if (e === '.png') {
    const png = new PNG({ width: level.width, height: level.height });
    png.data = Buffer.from(level.rgba.buffer, level.rgba.byteOffset, level.rgba.byteLength);
    bytes = new Uint8Array(PNG.sync.write(png));
  } else if (e === '.jpg' || e === '.jpeg') {
    bytes = new Uint8Array(jpeg.encode({ data: level.rgba, width: level.width, height: level.height }, 90).data);
  } else {
    const uastc = layout?.colorModel === KHR_DF_MODEL_UASTC;
    bytes = await enc!.encodeToKtx2({ type: enc!.ImageType.RGBA, data: level.rgba, width: level.width, height: level.height },
      { mode: uastc ? 'uastc' : 'etc1s', srgb: colour, mipmaps: true, supercompress: uastc });
  }
  return { bytes, ext, width: level.width, height: level.height, fullWidth: image.width, fullHeight: image.height };
}
