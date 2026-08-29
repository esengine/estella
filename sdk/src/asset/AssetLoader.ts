// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Backend } from './Backend';
import type { AssetLease } from './AssetLease';
import type { RegistryEra } from './registryAssets';
import type { Catalog } from './Catalog';
import type { TextureHandle, FontHandle } from '../types';
import type { CppResourceManager } from '../wasm';
import type { SpineAssetValue } from '../spine/prepareSpine';

export interface TextureResult {
    handle: TextureHandle;
    width: number;
    height: number;
}

/**
 * One spine PAIR: the two documents it is, and the atlas pages it holds. No
 * native skeleton — that belongs to a runtime backend of a particular Spine
 * version, is built from this, and dies with the entities posing it.
 */
export type SpineResult = SpineAssetValue;

export interface SpineLoadResult {
    success: boolean;
    error?: string;
}

export interface MaterialResult {
    handle: number;
    shaderHandle: number;
}

export interface FontResult {
    handle: FontHandle;
    /** Outline fonts (.ttf/.otf/.woff) only: the family name the font was
     *  registered with, which is what `Text` rasterizes against. Absent for
     *  bitmap fonts, whose handle IS the resource. */
    family?: string;
    /** Outline fonts only: the source path, so unload can drop the registration. */
    path?: string;
}

export interface AudioResult {
    bufferId: string;
}

export interface AnimClipResult {
    clipId: string;
}

export interface TilemapResult {
    sourceId: string;
}

export interface TilesetResult {
    /** The `.estileset` path the resolved tileset is cached under. */
    tilesetId: string;
}

export interface TimelineResult {
    timelineId: string;
}

export interface FsmResult {
    fsmId: string;
}

export interface AnimatorControllerResult {
    controllerId: string;
}

export interface LocaleResult {
    /** The locale the table's entries were merged into. */
    locale: string;
    /** How many keys the table carried. */
    keyCount: number;
}

export interface BtResult {
    btId: string;
}

export interface PrefabResult {
    data: unknown;
}

/**
 * A data asset's parsed document. `T` is the caller's claim about the file's
 * shape — the loader parses, it does not validate, so a wrong claim is a wrong
 * claim about untyped JSON exactly as `JSON.parse` would give.
 */
export interface JsonResult<T = unknown> {
    data: T;
}

export interface LoadContext {
    backend: Backend;
    catalog: Catalog;
    resourceManager: CppResourceManager;
    loadTexture(path: string, flipY?: boolean): Promise<TextureResult>;
    /**
     * Load a texture and get the receipt for THIS acquisition — what a loader
     * holding a texture past its own `load` needs, because a path-addressed
     * release after an invalidate gives back the oldest era rather than the one
     * this loader was handed.
     */
    acquireTexture(path: string, flipY?: boolean): Promise<AssetLease<TextureResult>>;
    /**
     * The same for an asset of ANY type — a material instance acquiring the
     * parent it diffs against. The general door; {@link acquireTexture} is the
     * one specialization, for the flip variants a texture has.
     */
    acquireAsset<T>(type: string, ref: string): Promise<AssetLease<T>>;
    loadText(path: string): Promise<string>;
    loadBinary(path: string): Promise<ArrayBuffer>;
    /**
     * Decode a texture ref to top-first RGBA pixels through the platform's ONE
     * decode path (a runtime-injected pixel decoder when present, else the
     * shared fetch→ImageBitmap route). For loaders that COMPOSE textures — the
     * tilemap loader folding an image-collection tileset into a grid atlas —
     * rather than uploading refs 1:1. Optional: minimal providers may lack it;
     * consumers fail loud.
     */
    decodePixels?(path: string): Promise<{ width: number; height: number; pixels: Uint8Array }>;
    /** Upload raw top-first RGBA as a texture (TextureLoader.loadFromPixels).
     *  Optional, same caveat as {@link decodePixels}. */
    createTextureFromPixels?(
        width: number, height: number, pixels: Uint8Array, flipY: boolean,
    ): Promise<TextureResult>;
    /**
     * The same upload, as something an era can OWN: a texture composed from
     * pixels has no path, no generation and no cache, so there is no receipt to
     * acquire — but it still has to be given back, and only the era that
     * composed it knows when. Releasing destroys it.
     */
    createOwnedTexture?(
        width: number, height: number, pixels: Uint8Array, flipY: boolean,
    ): Promise<AssetLease<TextureResult>>;
    /**
     * Read another asset's content because it shapes what this one becomes — a
     * `.tsj` folded into a `.tmj`. Takes the REF, not a build path: what is
     * recorded is the identity an invalidation will name.
     *
     * Nothing is held; what is recorded is that this asset must be rebuilt when
     * that content changes. A log setting read during a load is not one.
     */
    readSource?(ref: string): Promise<string>;
    /**
     * Audio API for the owning app, resolved lazily so that
     * AudioPlugin / AssetPlugin can be installed in either order.
     * Returns null when no AudioPlugin is installed — audio-typed
     * assets will fail to preload.
     */
    getAudio(): import('../audio/Audio').AudioAPI | null;
    /**
     * Sprite-animation API for the owning app (clip registry), resolved lazily
     * like {@link getAudio}. Returns null when no AnimationPlugin is installed.
     */
    getSpriteAnimation(): import('../animation/SpriteAnimator').SpriteAnimationAPI | null;
    /**
     * Localization service for the owning app, resolved lazily like
     * {@link getAudio}. Returns null when no LocalizationPlugin is installed —
     * loading a `.eslocale` then fails loud (a table with nowhere to register
     * is a setup error, not a soft skip).
     */
    getLocalization(): import('../i18n/Localization').LocalizationAPI | null;
}

/**
 * A loader whose asset lives in a REGISTRY under its ref: what a component
 * carries is the name, and every lookup asks what that name means now.
 *
 * Preparing is all of it. The slot holds the era and answers the lookup, so
 * there is no second place to write and nothing to keep in step with it.
 */
export interface RegistryAssetLoader<T> {
    prepare(path: string, ctx: LoadContext): Promise<RegistryEra<T>>;
}

/**
 * How one asset type is loaded. A loader implements EXACTLY ONE door: `load` +
 * `unload` for an asset a component holds by handle, or `registry` for one it
 * holds by ref. Two doors to the same asset is two answers about who owns it.
 */
export interface AssetLoader<T> {
    readonly type: string;
    readonly extensions: string[];
    load?(path: string, ctx: LoadContext): Promise<T>;
    /** Destroy what `load` made. What it ACQUIRED is the preparation's and goes
     *  back with the era — a loader releasing it here would free it twice. */
    unload?(asset: T): void;
    /** Set instead of `load`/`unload` when the asset is published by name. */
    registry?: RegistryAssetLoader<T>;
    /**
     * Sever any residency identity the loader's subsystem keeps for `path`
     * (hot reload: the source bytes changed, so a warm-cache entry must never
     * be revived). Called by `Assets.invalidate` for every registered loader,
     * whether or not the Assets-level cache held the path — the subsystem
     * cache can outlive it. Returns true if anything was dropped. Optional:
     * loaders whose results carry no out-of-Assets residency omit it.
     */
    invalidate?(path: string): boolean;
}
