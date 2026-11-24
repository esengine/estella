// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetLoader, LoadContext, AudioResult } from '../AssetLoader';
import type { AudioAPI } from '../../audio/Audio';
import { log } from '../../util/logger';

export class AudioAssetLoader implements AssetLoader<AudioResult> {
    private readonly releases_ = new WeakMap<AudioResult, () => void>();
    readonly type = 'audio';
    readonly fieldBinding = 'source';
    readonly extensions = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.webm'];

    /** Same lazy audio accessor Assets uses — needed by unload/invalidate,
     *  which have no LoadContext. Defaults to "no audio" for bare setups. */
    constructor(private readonly getAudio_: () => AudioAPI | null = () => null) {}

    async load(path: string, ctx: LoadContext, resolved = ctx.resolveRef?.(path) ?? path, address = resolved): Promise<AudioResult> {
        const audio = ctx.getAudio();
        if (!audio) {
            log.warn('asset', `AudioAssetLoader: no Audio resource for "${path}" (AudioPlugin not installed?)`);
            return { bufferId: path };
        }
        const buildPath = ctx.catalog.getBuildPath(resolved);
        const file = { url: ctx.backend.resolveUrl(buildPath), address, prepareFile: ctx.backend.prepareFile?.bind(ctx.backend) };
        const buffer = await audio.acquireAssetBuffer(path, file, () => ctx.loadBinary(buildPath));
        const result = { bufferId: path };
        if (buffer) this.releases_.set(result, () => {
            if (audio.getBufferHandle(path) === buffer) audio.releaseBuffer(path);
        });
        return result;
    }

    unload(asset: AudioResult): void {
        const release = this.releases_.get(asset);
        this.releases_.delete(asset);
        release?.();
    }

    invalidate(path: string): boolean {
        return this.getAudio_()?.invalidateBuffer(path) ?? false;
    }
}
