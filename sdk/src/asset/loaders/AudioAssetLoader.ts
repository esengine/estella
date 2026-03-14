import type { AssetLoader, LoadContext, AudioResult } from '../AssetLoader';
import { Audio } from '../../audio/Audio';

export class AudioAssetLoader implements AssetLoader<AudioResult> {
    readonly type = 'audio';
    readonly extensions = ['.mp3', '.wav', '.ogg', '.m4a', '.aac'];

    async load(path: string, ctx: LoadContext): Promise<AudioResult> {
        const buildPath = ctx.catalog.getBuildPath(path);
        const buffer = await ctx.loadBinary(buildPath);
        await Audio.preloadFromData(path, buffer);
        return { bufferId: path };
    }

    unload(_asset: AudioResult): void {
        // Audio buffers are managed globally by Audio system
    }
}
