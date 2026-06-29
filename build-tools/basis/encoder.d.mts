// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Types for encoder.mjs so TS consumers (the asset cook) import it with full typing.

export type ImageTypeValue = 'png' | 'jpg' | 'rgba';
export const ImageType: { readonly PNG: 'png'; readonly JPG: 'jpg'; readonly RGBA: 'rgba' };

export interface EncodeSource {
  type: ImageTypeValue;
  data: Uint8Array;
  /** Required for RGBA sources; read from the header for PNG. */
  width?: number;
  height?: number;
}

export interface EncodeOptions {
  /** 'uastc' = high quality / universal (default); 'etc1s' = smaller. */
  mode?: 'uastc' | 'etc1s';
  mipmaps?: boolean;
  srgb?: boolean;
  perceptual?: boolean;
  /** ETC1S quality 1..255. */
  quality?: number;
  normalMap?: boolean;
}

export interface RgbaResult {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export function encodeToKtx2(source: EncodeSource, opts?: EncodeOptions): Promise<Uint8Array>;
export function encodePngToKtx2(png: Uint8Array, opts?: EncodeOptions): Promise<Uint8Array>;
export function transcodeKtx2ToRgba(ktx2: Uint8Array): Promise<RgbaResult>;
