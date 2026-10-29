// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/ui/sprite.ts
 * @brief   `Sprite` and `UIOpacity`: views on the engine's `Sprite` and `GroupOpacity`.
 *
 * Colour, the draw type and the enable flag map directly. The frame (`spriteFrame`) is a texture, which the engine addresses by a
 * handle that an asset load produces; assigning one is the asset layer's job, so here the frame is the path the `Sprite` was made
 * with and assigning a path is carried to the engine's `texture` only where the project's assets have already loaded it.
 */
import { GroupOpacity, Sprite as EngineSprite } from '../../ecs/component';
import { SpriteDrawMode } from '../../wasm/wasm.generated';
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { Color } from '../math';
import { Component } from '../component';
import { registerBuiltinComponent } from '../builtins';
import { toCocosColor, toEngineColor, viewAdapter } from './view';

/** Cocos's `Sprite.Type`: SIMPLE, SLICED, TILED, FILLED. */
const SpriteType = Object.freeze({ SIMPLE: 0, SLICED: 1, TILED: 2, FILLED: 3 });
const SizeMode = Object.freeze({ CUSTOM: 0, TRIMMED: 1, RAW: 2 });

function toEngineDrawMode(type: number): SpriteDrawMode {
    if (type === SpriteType.SLICED) return SpriteDrawMode.NineSlice;
    if (type === SpriteType.TILED) return SpriteDrawMode.Tiled;
    return SpriteDrawMode.Simple;   // SIMPLE, and FILLED, which the engine draws whole
}

function toCocosType(mode: SpriteDrawMode | undefined): number {
    if (mode === SpriteDrawMode.NineSlice) return SpriteType.SLICED;
    if (mode === SpriteDrawMode.Tiled) return SpriteType.TILED;
    return SpriteType.SIMPLE;
}

export class Sprite extends Component {
    static readonly Type = SpriteType;
    static readonly SizeMode = SizeMode;

    private data_() { return this._world.get(this._entity, EngineSprite); }
    private patch_(patch: Partial<ReturnType<Sprite['data_']>>): void { this._world.set(this._entity, EngineSprite, { ...this.data_(), ...patch }); }

    get color(): Color { return toCocosColor(this.data_().color); }
    set color(v: Color) { this.patch_({ color: toEngineColor(v) }); }

    get type(): number { return toCocosType(this.data_().drawMode); }
    set type(v: number) { this.patch_({ drawMode: toEngineDrawMode(v) }); }

    /** The frame is set by the asset layer; the engine draws whatever texture the sprite holds. */
    sizeMode = SizeMode.CUSTOM;
    /** Not carried: the engine has no grayscale draw for a sprite. */
    grayscale = false;
    fillType = 0;
    fillRange = 0;

    get enabled(): boolean { return this.data_().enabled; }
    set enabled(v: boolean) { this.patch_({ enabled: v }); }
}

/** `UIOpacity`: the alpha of a node and everything under it, which is the engine's `GroupOpacity` (0..1) in Cocos's 0..255. */
export class UIOpacity extends Component {
    get opacity(): number { return Math.round(this._world.get(this._entity, GroupOpacity).opacity * 255); }
    set opacity(v: number) {
        const opacity = Math.min(255, Math.max(0, v)) / 255;
        this._world.set(this._entity, GroupOpacity, { ...this._world.get(this._entity, GroupOpacity), opacity });
    }

    get enabled(): boolean { return this._world.get(this._entity, GroupOpacity).enabled; }
    set enabled(v: boolean) { this._world.set(this._entity, GroupOpacity, { ...this._world.get(this._entity, GroupOpacity), enabled: v }); }
}

const hasSprite = (world: World, entity: Entity): boolean => world.has(entity, EngineSprite);
const addSprite = (world: World, entity: Entity): void => { world.insert(entity, EngineSprite, {}); };

registerBuiltinComponent(Sprite, ['cc.Sprite', 'Sprite'], viewAdapter(Sprite, hasSprite, addSprite));
registerBuiltinComponent(UIOpacity, ['cc.UIOpacity', 'UIOpacity'], viewAdapter(
    UIOpacity,
    (world, entity) => world.has(entity, GroupOpacity),
    (world, entity) => { world.insert(entity, GroupOpacity, {}); },
));
