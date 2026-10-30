// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/assets.ts
 * @brief   The asset classes a script names in a `@property` type: `SpriteFrame`, `Prefab`, `AudioClip`, ….
 *
 * In the engine an asset reference is a project-relative path, so these are markers: the class exists so that
 * `@property(SpriteFrame)` can say "this field is a sprite frame", and a value held in such a field is the path (loading it is
 * the asset system's job). They carry no behaviour.
 */
import { Material as EngineMaterial } from '../render/material';

export class Asset { constructor(public path = '') {} }
export class ImageAsset extends Asset {}
export class Texture2D extends Asset {}
export class SpriteFrame extends Asset {}
export class SpriteAtlas extends Asset {}
/** Prepared prefabs by path: shared by every `Prefab` handle that names the path. */
export const preparedPrefabs = new Map<string, unknown>();

/**
 * A prefab a script holds. `instantiate` is synchronous in Cocos, which is only possible because the prefab was loaded first; here
 * that is the prepared form (see prefabs.ts), made once per path as soon as a script holds the handle.
 */
export class Prefab extends Asset {
    /** The engine's prepared prefab, once it has loaded. @internal */
    get _prepared(): unknown { return preparedPrefabs.get(this.path); }
    /** Why preparing failed, when it did. @internal */
    _failed = '';
}
export class AudioClip extends Asset {}
/** A property value as the engine's material takes it: a number, or a vector of up to four. Colours are 0..255 here and 0..1 there. */
function uniformOf(value: unknown): number | { x: number; y: number; z: number; w: number } | null {
    if (typeof value === 'number') return value;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value !== 'object' || value === null) return null;
    const v = value as Record<string, unknown>;
    if (typeof v.r === 'number' && typeof v.g === 'number' && typeof v.b === 'number') {
        return { x: v.r / 255, y: v.g / 255, z: v.b / 255, w: typeof v.a === 'number' ? v.a / 255 : 1 };
    }
    if (typeof v.x === 'number' && typeof v.y === 'number') {
        return { x: v.x, y: v.y, z: typeof v.z === 'number' ? v.z : 0, w: typeof v.w === 'number' ? v.w : 0 };
    }
    return null;
}

/**
 * `Material`: the engine's material (`handle`) with Cocos's property calls. A value is written to the engine material under the name the
 * script gives it, and kept here so `getProperty` answers; a project effect's own property names are not the engine shader's, so a
 * write the shader does not declare is the engine's to report and ignore.
 */
export class Material extends Asset {
    /** The engine material this stands for; 0 for one the engine has not loaded. @internal */
    _handle = 0;
    private readonly props_ = new Map<string, unknown>();

    /**
     * Where a property goes that is not a shader parameter here: the renderer an instance belongs to holds its colour itself. Answers whether it
     * took the property. @internal
     */
    _take?: (name: string, value: unknown) => boolean;

    setProperty(name: string, value: unknown, _passIndex?: number): void {
        this.props_.set(name, value);
        if (this._take?.(name, value)) return;
        const uniform = uniformOf(value);
        if (this._handle > 0 && uniform !== null) EngineMaterial.setUniform(this._handle, name, uniform);
    }

    /** What the property was last set to. @internal */
    _give?: (name: string) => unknown;

    getProperty(name: string, _passIndex?: number): unknown {
        return this._give?.(name) ?? this.props_.get(name);
    }

    /** The material's passes: there is one, and it has no state a script can read. */
    get passes(): never[] { return []; }
}
export class JsonAsset extends Asset { json: unknown = null; }
export class TextAsset extends Asset { text = ''; }
export class BitmapFont extends Asset {}
export class Font extends Asset {}
export class AnimationClip extends Asset {}
export class SceneAsset extends Asset {}
export class EffectAsset extends Asset {}
export class Mesh extends Asset {}

/** Whether a `@property` type names an asset class. */
export function isAssetClass(type: unknown): boolean {
    return typeof type === 'function' && (type === Asset || type.prototype instanceof Asset);
}
