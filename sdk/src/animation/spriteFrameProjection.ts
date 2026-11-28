// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { SpriteData } from '../ecs/component';
import type { Vec2 } from '../types';
import type { SpriteAnimFrame } from './SpriteAnimator';

export const SPRITE_FRAME_FIELDS = ['texture', 'uvOffset', 'uvScale', 'size', 'pivot'] as const;
export type SpriteFrameField = typeof SPRITE_FRAME_FIELDS[number];
export type SpriteFramePose = Partial<Pick<SpriteData, SpriteFrameField>>;

const FULL_FRAME_OFFSET = { x: 0, y: 0 };
const FULL_FRAME_SCALE = { x: 1, y: 1 };

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
    const uvOffset = offset ?? FULL_FRAME_OFFSET;
    const uvScale = offset && scale ? scale : FULL_FRAME_SCALE;
    sprite.uvOffset = { x: uvOffset.x, y: uvOffset.y };
    sprite.uvScale = { x: uvScale.x, y: uvScale.y };
}

export interface SpritePoseTracking {
    base: SpriteFramePose;
    projected: SpriteFramePose;
}

function projectVector(sprite: SpriteData, pose: SpritePoseTracking, key: Exclude<SpriteFrameField, 'texture'>, next: Vec2): boolean {
    const current = sprite[key];
    if (current.x === next.x && current.y === next.y) return false;
    const projected = pose.projected[key];
    if (!projected || projected.x !== current.x || projected.y !== current.y) {
        const base = pose.base[key] ??= { x: 0, y: 0 };
        base.x = current.x;
        base.y = current.y;
    }
    const snapshot = pose.projected[key] ??= { x: 0, y: 0 };
    snapshot.x = next.x;
    snapshot.y = next.y;
    sprite[key] = { x: next.x, y: next.y };
    return true;
}

/** Apply only fields whose rendered values change. Snapshots never alias the live Sprite. */
export function applyTrackedSpriteFrame(sprite: SpriteData, frame: SpriteAnimFrame, pose: SpritePoseTracking): boolean {
    const textureChanged = sprite.texture !== frame.texture;
    if (textureChanged) {
        if (sprite.texture !== pose.projected.texture) pose.base.texture = sprite.texture;
        pose.projected.texture = frame.texture;
        sprite.texture = frame.texture;
    }
    const offsetChanged = projectVector(sprite, pose, 'uvOffset', frame.uvOffset ?? FULL_FRAME_OFFSET);
    const scaleChanged = projectVector(sprite, pose, 'uvScale', frame.uvOffset && frame.uvScale ? frame.uvScale : FULL_FRAME_SCALE);
    const sizeChanged = frame.size && projectVector(sprite, pose, 'size', frame.size);
    const pivotChanged = frame.pivot && projectVector(sprite, pose, 'pivot', frame.pivot);
    return textureChanged || offsetChanged || scaleChanged || sizeChanged === true || pivotChanged === true;
}
