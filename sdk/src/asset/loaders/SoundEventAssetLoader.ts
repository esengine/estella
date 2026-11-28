// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetLoader, LoadContext } from '../AssetLoader';
import { parseSoundEvent, type SoundEventAsset } from '../../audio/SoundEvent';
import { mapSoundEventClipRefs } from '../../audio/soundEventRefs';
import { resolveIndexedProjectRef } from '../documentRef';

/** Loads a validated event definition without decoding every candidate sound. */
export class SoundEventAssetLoader implements AssetLoader<SoundEventAsset> {
    readonly type = 'sound-event';
    readonly extensions = ['.esaudioevent'];

    async load(path: string, ctx: LoadContext): Promise<SoundEventAsset> {
        const text = await ctx.loadText(ctx.catalog.getBuildPath(path));
        try {
            const event = parseSoundEvent(JSON.parse(text));
            const document = ctx.sourceAddressOf?.(path) ?? path;
            mapSoundEventClipRefs(event, ref => resolveIndexedProjectRef(document, ref, candidate => ctx.assetTypeOf?.(candidate) !== undefined));
            return event;
        } catch (error) {
            throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    unload(): void {
        // Definitions hold no audio buffers; voices own their decoded clip leases.
    }
}
