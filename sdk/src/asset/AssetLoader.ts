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

export interface TimelineResult {
    timelineId: string;
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
     * Audio API for the owning app, resolved lazily so that
     * AudioPlugin / AssetPlugin can be installed in either order.
     * Returns null when no AudioPlugin is installed — audio-typed
     * assets will fail to preload.
     */
    getAudio(): import('../audio/Audio').AudioAPI | null;
}

export interface AssetLoader<T> {
    readonly type: string;
    readonly extensions: string[];
    load(path: string, ctx: LoadContext): Promise<T>;
    unload(asset: T): void;
}
