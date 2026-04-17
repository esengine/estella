import type { AssetLoader, LoadContext, AnimClipResult } from '../AssetLoader';
import { extractAnimClipTexturePaths, parseAnimClipData, type AnimClipAssetData } from '../../animation/AnimClipLoader';
import { registerAnimClip } from '../../animation/SpriteAnimator';
import { log } from '../../logger';

export class AnimClipAssetLoader implements AssetLoader<AnimClipResult> {
    readonly type = 'anim-clip';
    readonly extensions = ['.esanim'];

    async load(path: string, ctx: LoadContext): Promise<AnimClipResult> {
        const buildPath = ctx.catalog.getBuildPath(path);
        const text = await ctx.loadText(buildPath);
        const data: AnimClipAssetData = JSON.parse(text);
        const texturePaths = extractAnimClipTexturePaths(data);
        const textureHandles = new Map<string, number>();

        for (const texPath of texturePaths) {
            try {
                const result = await ctx.loadTexture(texPath, true);
                textureHandles.set(texPath, result.handle);
            } catch (e) {
                log.warn('asset', `Failed to load texture: ${texPath}`, e);
                textureHandles.set(texPath, 0);
            }
        }

        const clip = parseAnimClipData(path, data, textureHandles);
        registerAnimClip(clip);

        return { clipId: path };
    }

    unload(_asset: AnimClipResult): void {
        // AnimClips registered globally, no per-asset cleanup
    }
}
