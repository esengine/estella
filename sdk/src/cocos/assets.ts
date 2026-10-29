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
export class Material extends Asset {}
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
