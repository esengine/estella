// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    glTexParams.ts
 * @brief   Shared WebGL texture-parameter mapping. The wrap-mode → GL enum was
 *          duplicated byte-for-byte in the RGBA (TextureLoader) and compressed
 *          (compressed.ts) upload paths; this is its single source.
 *
 *          Filter used to stay per-path, because only the RGBA path chose
 *          mipmap min-filters. It no longer does: whole sampler state is
 *          {@link ../glTextureUpload#applyBoundTextureSampling}, which takes
 *          "has mipmaps" as the one input the two paths actually differed on.
 */

export type TextureWrap = 'repeat' | 'clamp' | 'mirror';

/** WebGL wrap-mode enum for a wrap string. Unknown / undefined → `REPEAT`. */
export function glWrapMode(gl: WebGL2RenderingContext, wrap: TextureWrap | undefined): number {
    return wrap === 'clamp' ? gl.CLAMP_TO_EDGE
        : wrap === 'mirror' ? gl.MIRRORED_REPEAT
        : gl.REPEAT;
}
