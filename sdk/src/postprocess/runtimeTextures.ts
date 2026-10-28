// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    runtimeTextures.ts
 * @brief   A texture an effect reads that no asset names: one the engine draws each frame and hands to the effect by a ref that carries its handle.
 * @details An effect's textures are refs that resolve through the Assets, which a texture drawn at run time is not in. The ref says where to look
 *          instead: `@runtime:<name>#<handle>`. The handle is in the ref, so a texture made again after a lost device is a new ref and the stack rebinds.
 */

const PREFIX = '@runtime:';

/** The ref that names a runtime texture. */
export function runtimeTextureRef(name: string, handle: number): string {
    return `${PREFIX}${name}#${handle}`;
}

/** The resource handle a runtime ref names, or null for a ref that is an asset's. */
export function runtimeTextureHandle(ref: string): number | null {
    if (!ref.startsWith(PREFIX)) return null;
    const handle = Number(ref.slice(ref.lastIndexOf('#') + 1));
    return Number.isFinite(handle) && handle > 0 ? handle : null;
}
