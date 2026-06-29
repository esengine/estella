// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * PNG/JPG/RGBA → KTX2 (Basis Universal) encoder for the build-time asset cook
 * (RC6 Batch B4). Wraps the vendored, prebuilt Basis encoder wasm
 * (basis_encoder.cjs + basis_encoder.wasm — built from third_party/basis_universal,
 * see README.md) behind a small Promise API. Build-time only: the *runtime*
 * transcoder is a separate side module (sdk/src/asset/basisTranscoder.ts).
 *
 * UASTC is emitted WITHOUT KTX2 zstd supercompression, because the engine's
 * runtime transcoder is built BASISD_SUPPORT_KTX2_ZSTD=0 (CMakeLists.txt); a
 * zstd-supercompressed UASTC KTX2 would fail to transcode at runtime. ETC1S needs
 * no supercompression. Both transcode at runtime to ASTC/ETC2/BC (compressed.ts).
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const DIR = path.dirname(fileURLToPath(import.meta.url));

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

/** PNG IHDR width/height (big-endian u32 at byte offsets 16 / 20). */
function pngDimensions(png) {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

export const ImageType = { PNG: 'png', JPG: 'jpg', RGBA: 'rgba' };

/**
 * Encode a source image to a KTX2 container.
 *   source: { type: ImageType, data: Uint8Array, width?, height? }
 *           width/height are read from the PNG header when omitted; required for RGBA.
 *   opts:   { mode: 'uastc'|'etc1s', mipmaps, srgb, perceptual, quality, normalMap }
 * Returns the KTX2 bytes (Uint8Array).
 */
export async function encodeToKtx2(source, opts = {}) {
  const {
    mode = 'uastc', mipmaps = true, srgb = true,
    perceptual = true, quality = 128, normalMap = false,
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
    enc.setKTX2UASTCSupercompression(false); // runtime transcoder is zstd=0
    enc.setKTX2AndBasisSRGBTransferFunc(srgb);
    if (!enc.setSliceSourceImage(0, source.data, width, height, imgType)) {
      throw new Error('encodeToKtx2: setSliceSourceImage failed (corrupt/unsupported source)');
    }
    if (mode === 'uastc') {
      enc.setUASTC(true);
    } else {
      enc.setUASTC(false);
      enc.setQualityLevel(quality);
    }
    enc.setPerceptual(perceptual);
    enc.setMipGen(mipmaps);
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
