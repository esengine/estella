// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The encoder on the calling thread: one wasm instance, one image at a time.
 * encoder.mjs is the public face and runs this on worker threads; the cook
 * never imports it directly.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const DIR = path.dirname(fileURLToPath(import.meta.url));

/** The encoder binary; what an encode cache keys "which encoder" by. */
export const ENCODER_WASM = path.join(DIR, 'basis_encoder.wasm');

/** The wasm module is heavy to instantiate (~MBs); load + init it once. */
let modulePromise = null;
function loadModule() {
  if (!modulePromise) {
    const BASIS = require(path.join(DIR, 'basis_encoder.cjs'));
    modulePromise = BASIS({ locateFile: (f) => path.join(DIR, f) }).then((m) => {
      m.initializeBasis();
      return m;
    });
  }
  return modulePromise;
}

/** Bytes of wasm heap this thread's encoder holds — it grows to the largest image
 *  seen and never gives memory back, which is what a pool must budget for. */
export async function heapBytes() {
  return (await loadModule()).HEAP8.length;
}

/** PNG IHDR width/height (big-endian u32 at byte offsets 16 / 20). */
function pngDimensions(png) {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

export const ImageType = { PNG: 'png', JPG: 'jpg', RGBA: 'rgba' };

/**
 * Encode a source image to KTX2 bytes; `source` and `opts` are typed in encoder.d.mts.
 * yFlip defaults on: uncompressed uploads are row-flipped at load, compressed
 * blocks cannot be, so the orientation is baked in here or the texture mirrors.
 */
export async function encodeToKtx2(source, opts = {}) {
  const {
    mode = 'uastc', mipmaps = true, srgb = true,
    perceptual = true, quality = 128, normalMap = false, yFlip = true, supercompress = false,
    uastcLevel,
  } = opts;
  const m = await loadModule();

  let width = source.width ?? 0;
  let height = source.height ?? 0;
  if (source.type === ImageType.PNG && (!width || !height)) {
    ({ width, height } = pngDimensions(source.data));
  }
  if (!width || !height) {
    throw new Error('encodeToKtx2: width/height unknown (provide them for non-PNG sources)');
  }

  const imgType =
    source.type === ImageType.PNG ? m.ldr_image_type.cPNGImage.value :
    source.type === ImageType.JPG ? m.ldr_image_type.cJPGImage.value :
    m.ldr_image_type.cRGBA32.value;

  const enc = new m.BasisEncoder();
  try {
    enc.setCreateKTX2File(true);
    enc.setKTX2UASTCSupercompression(supercompress);
    enc.setKTX2AndBasisSRGBTransferFunc(srgb);
    if (!enc.setSliceSourceImage(0, source.data, width, height, imgType)) {
      throw new Error('encodeToKtx2: setSliceSourceImage failed (corrupt/unsupported source)');
    }
    if (mode === 'uastc') {
      enc.setUASTC(true);
      if (uastcLevel !== undefined) enc.setPackUASTCFlags(uastcLevel);
    } else {
      enc.setUASTC(false);
      enc.setQualityLevel(quality);
    }
    enc.setPerceptual(perceptual);
    enc.setMipGen(mipmaps);
    enc.setYFlip(yFlip);
    if (normalMap) enc.setNormalMap();

    // RGBA8 is a safe upper bound for UASTC (1 B/px) + mips (~+1/3) + container.
    const out = new Uint8Array(width * height * 4 + 65536);
    const n = enc.encode(out);
    if (n <= 0) throw new Error('encodeToKtx2: encoder produced 0 bytes');
    return out.slice(0, n);
  } finally {
    enc.delete();
  }
}

/** Convenience: encode PNG bytes (dimensions read from the PNG header). */
export function encodePngToKtx2(png, opts) {
  return encodeToKtx2({ type: ImageType.PNG, data: png }, opts);
}

/**
 * Transcode a KTX2 back to RGBA8 (level 0) — validates encodes and round-trips
 * the pipeline. Returns { width, height, pixels: Uint8Array (w*h*4) }.
 */
export async function transcodeKtx2ToRgba(ktx2) {
  const m = await loadModule();
  const file = new m.KTX2File(ktx2);
  try {
    if (!file.isValid()) throw new Error('transcodeKtx2ToRgba: invalid KTX2');
    if (!file.startTranscoding()) throw new Error('transcodeKtx2ToRgba: startTranscoding failed');
    const width = file.getWidth();
    const height = file.getHeight();
    const RGBA = m.transcoder_texture_format.cTFRGBA32.value;
    const size = file.getImageTranscodedSizeInBytes(0, 0, 0, RGBA);
    const dst = new Uint8Array(size);
    if (!file.transcodeImage(dst, 0, 0, 0, RGBA, 0, -1, -1)) {
      throw new Error('transcodeKtx2ToRgba: transcodeImage failed');
    }
    return { width, height, pixels: dst };
  } finally {
    file.close();
    file.delete();
  }
}
