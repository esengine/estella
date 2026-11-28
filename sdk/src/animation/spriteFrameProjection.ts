// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { SpriteData } from '../ecs/component';
import type { Vec2 } from '../types';

/** A frame without a sheet window draws the complete texture. */
export function setSpriteFrameTexture(sprite: SpriteData, texture: SpriteData['texture'], offset?: Vec2, scale?: Vec2): void {
    sprite.texture = texture;
    sprite.uvOffset = offset ? { x: offset.x, y: offset.y } : { x: 0, y: 0 };
    sprite.uvScale = offset && scale ? { x: scale.x, y: scale.y } : { x: 1, y: 1 };
}
