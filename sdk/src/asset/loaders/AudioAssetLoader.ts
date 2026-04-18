import type { AssetLoader, LoadContext, AudioResult } from '../AssetLoader';
import { log } from '../../logger';

export class AudioAssetLoader implements AssetLoader<AudioResult> {
    readonly type = 'audio';
    readonly extensions = ['.mp3', '.wav', '.ogg', '.m4a', '.aac'];

    async load(path: string, ctx: LoadContext): Promise<AudioResult> {
        const audio = ctx.getAudio();
        if (!audio) {
            log.warn('asset', `AudioAssetLoader: no Audio resource for "${path}" (AudioPlugin not installed?)`);
            return { bufferId: path };
        }
        const buildPath = ctx.catalog.getBuildPath(path);
        const buffer = await ctx.loadBinary(buildPath);
        await audio.preloadFromData(path, buffer);
        return { bufferId: path };
    }

    unload(_asset: AudioResult): void {
        // Audio buffers are owned by the app's AudioAPI and freed on
        // plugin teardown via `audio.dispose()`.
    }
}
