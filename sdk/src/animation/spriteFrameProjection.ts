// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { SpriteData } from '../ecs/component';
import type { Vec2 } from '../types';

export const SPRITE_FRAME_FIELDS = ['texture', 'uvOffset', 'uvScale', 'size', 'pivot'] as const;
export type SpriteFrameField = typeof SPRITE_FRAME_FIELDS[number];
export type SpriteFramePose = Partial<Pick<SpriteData, SpriteFrameField>>;

export function sameSpriteFrameField(a: SpriteFramePose[SpriteFrameField], b: SpriteFramePose[SpriteFrameField]): boolean {
    return a === b || (a != null && b != null && typeof a === 'object' && typeof b === 'object' && a.x === b.x && a.y === b.y);
}

export function copySpriteFrameField<K extends SpriteFrameField>(target: SpriteFramePose, key: K, value: SpriteFramePose[K]): void {
    if (value === undefined) delete target[key];
    else target[key] = typeof value === 'object' ? { ...value } : value;
}

/** Recover only fields still displaying the animation's last projection. */
export function restoredSpriteFramePose<T extends SpriteFramePose>(sprite: T, base: SpriteFramePose, projected: SpriteFramePose): T | undefined {
    let restored: T | undefined;
    for (const key of SPRITE_FRAME_FIELDS) {
        if (!sameSpriteFrameField(sprite[key], projected[key]) || sameSpriteFrameField(sprite[key], base[key])) continue;
        restored ??= { ...sprite };
        copySpriteFrameField(restored, key, base[key]);
    }
    return restored;
}

/** A frame without a sheet window draws the complete texture. */
export function setSpriteFrameTexture(sprite: SpriteData, texture: SpriteData['texture'], offset?: Vec2, scale?: Vec2): void {
    sprite.texture = texture;
    sprite.uvOffset = offset ? { x: offset.x, y: offset.y } : { x: 0, y: 0 };
    sprite.uvScale = offset && scale ? { x: scale.x, y: scale.y } : { x: 1, y: 1 };
}
