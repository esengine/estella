// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Backend } from './Backend';
import type { Catalog } from './Catalog';
import type { TextureHandle, FontHandle } from '../types';
import type { CppResourceManager } from '../wasm';

export interface TextureResult {
    handle: TextureHandle;
    width: number;
    height: number;
}

export interface SpineResult {
    skeletonHandle: number;
}

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

export interface LoadContext {
    backend: Backend;
    catalog: Catalog;
    resourceManager: CppResourceManager;
    loadTexture(path: string, flipY?: boolean): Promise<TextureResult>;
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
    getSpriteAnimation(): import('../animation/SpriteAnimator').SpriteAnimationApi | null;
    /**
     * Localization service for the owning app, resolved lazily like
     * {@link getAudio}. Returns null when no LocalizationPlugin is installed —
     * loading a `.eslocale` then fails loud (a table with nowhere to register
     * is a setup error, not a soft skip).
     */
    getLocalization(): import('../i18n/Localization').LocalizationApi | null;
}

export interface AssetLoader<T> {
    readonly type: string;
    readonly extensions: string[];
    load(path: string, ctx: LoadContext): Promise<T>;
    unload(asset: T): void;
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
