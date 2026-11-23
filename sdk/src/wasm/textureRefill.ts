// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

/** Puts a texture's content back after a device loss. */
export type TextureRefill = () => boolean | Promise<boolean>;

const refills = new Map<number, TextureRefill>();

/** @internal Handles and their producers belong to the active resource manager. */
export function clearTextureRefills(): void { refills.clear(); }

/** @internal Restore this handle through the producer that owns its pixels. */
export function provideTextureContent(handle: number, refill: TextureRefill): void { refills.set(handle, refill); }

/** @internal A producer may withdraw only its own registration when a handle has changed hands. */
export function withdrawTextureContent(handle: number, expected?: TextureRefill): void {
    if (!expected || refills.get(handle) === expected) refills.delete(handle);
}

/** @internal Who refills this handle, if anyone registered a producer. */
export function textureRefill(handle: number): TextureRefill | undefined { return refills.get(handle); }
