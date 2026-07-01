// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    glTexParams.ts
 * @brief   Shared WebGL texture-parameter mapping. The wrap-mode → GL enum was
 *          duplicated byte-for-byte in the RGBA (TextureLoader) and compressed
 *          (compressed.ts) upload paths; this is its single source. (Filter →
 *          GL stays per-path: the RGBA path chooses mipmap min-filters, the
 *          single-level compressed path never does.)
 */

export type TextureWrap = 'repeat' | 'clamp' | 'mirror';

/** WebGL wrap-mode enum for a wrap string. Unknown / undefined → `REPEAT`. */
export function glWrapMode(gl: WebGL2RenderingContext, wrap: TextureWrap | undefined): number {
    return wrap === 'clamp' ? gl.CLAMP_TO_EDGE
        : wrap === 'mirror' ? gl.MIRRORED_REPEAT
        : gl.REPEAT;
}
