// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetLoader, LoadContext, AudioResult } from '../AssetLoader';
import type { AudioAPI } from '../../audio/Audio';
import { log } from '../../util/logger';

export class AudioAssetLoader implements AssetLoader<AudioResult> {
    readonly type = 'audio';
    readonly extensions = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.webm'];

    /** Same lazy audio accessor Assets uses — needed by unload/invalidate,
     *  which have no LoadContext. Defaults to "no audio" for bare setups. */
    constructor(private readonly getAudio_: () => AudioAPI | null = () => null) {}

    async load(path: string, ctx: LoadContext): Promise<AudioResult> {
        const audio = ctx.getAudio();
        if (!audio) {
            log.warn('asset', `AudioAssetLoader: no Audio resource for "${path}" (AudioPlugin not installed?)`);
            return { bufferId: path };
        }
        // Warm-cache hit: the buffer survived its last release as an evictable
        // entry — pin it and skip the whole fetch + decode.
        if (audio.retainBuffer(path)) {
            return { bufferId: path };
        }
        const buildPath = ctx.catalog.getBuildPath(path);
        const buffer = await ctx.loadBinary(buildPath);
        await audio.preloadFromData(path, buffer);
        audio.retainBuffer(path);
        return { bufferId: path };
    }

    unload(asset: AudioResult): void {
        // Drops the one reference Assets holds; the AudioAPI decides what that
        // means — retain as an evictable warm-cache entry under the budget, or
        // free outright when the budget is 0.
        this.getAudio_()?.releaseBuffer(asset.bufferId);
    }

    invalidate(path: string): boolean {
        return this.getAudio_()?.invalidateBuffer(path) ?? false;
    }
}
