// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/ui/mask.ts
 * @brief   `Mask`: a view on the engine's `UIMask`, clipping the node's children to its rectangle.
 *
 * The clip box is the node's `ContentRect` (what `UITransform` reads and writes), so a mask is an engine `UIMask` on a node that
 * has a size, and the renderer's scissor does the work. A rectangle mask is exact. The shaped types — ellipse, graphics, image — clip
 * to the same rectangle: the engine cuts a shape from a sprite on the node, which a Cocos mask does not carry. `inverted` is not
 * carried either. Both are held so a script can read back what it set.
 */
import { UIMask, MaskMode } from '../../ui/core/ui-mask';
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { Component } from '../component';
import { registerBuiltinComponent } from '../builtins';
import { ensureUITransform } from './uiTransform';
import { viewAdapter } from './view';

const Type = Object.freeze({ RECT: 0, ELLIPSE: 1, GRAPHICS_STENCIL: 2, IMAGE_STENCIL: 3 });

export class Mask extends Component {
    static readonly Type = Type;

    type: number = Type.RECT;
    inverted = false;
    segments = 64;
    alphaThreshold = 0.1;

    get enabled(): boolean { return this._world.get(this._entity, UIMask).enabled; }
    set enabled(v: boolean) { this._world.set(this._entity, UIMask, { ...this._world.get(this._entity, UIMask), enabled: v }); }
}

const hasMask = (world: World, entity: Entity): boolean => world.has(entity, UIMask);
const addMask = (world: World, entity: Entity): void => {
    ensureUITransform(world, entity);
    world.insert(entity, UIMask, { enabled: true, mode: MaskMode.Scissor, alphaCutoff: 0 });
};

registerBuiltinComponent(Mask, ['cc.Mask', 'Mask'], viewAdapter(Mask, hasMask, addMask));
