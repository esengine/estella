// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    TimelineAssetRegistry.ts
 * @brief   Leaf seam between the timeline asset loader and TimelinePlugin.
 *
 * The loader writes parsed assets through these free functions without
 * importing TimelinePlugin — importing it would close a module cycle through
 * AssetPlugin/Assets. TimelinePlugin implements the registry and binds itself
 * active on build.
 */
import type { TimelineAsset } from './TimelineTypes';

export interface TimelineAssetRegistry {
    registerAsset(path: string, asset: TimelineAsset): void;
    getAsset(path: string): TimelineAsset | undefined;
    registerTextureHandles(path: string, handles: Map<string, number>): void;
    getTextureHandle(timelinePath: string, textureUuid: string): number;
}

let active: TimelineAssetRegistry | null = null;

/** @internal TimelinePlugin binds itself on build and unbinds on cleanup. */
export function setActiveTimelineAssetRegistry(registry: TimelineAssetRegistry | null): void {
    active = registry;
}

export function registerTimelineAsset(path: string, asset: TimelineAsset): void {
    active?.registerAsset(path, asset);
}

export function getTimelineAsset(path: string): TimelineAsset | undefined {
    return active?.getAsset(path);
}

export function registerTimelineTextureHandles(path: string, handles: Map<string, number>): void {
    active?.registerTextureHandles(path, handles);
}

export function getTimelineTextureHandle(timelinePath: string, textureUuid: string): number {
    return active?.getTextureHandle(timelinePath, textureUuid) ?? 0;
}
