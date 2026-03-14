import type { AssetLoader, LoadContext, TimelineResult } from '../AssetLoader';
import { parseTimelineAsset, extractTimelineAssetPaths } from '../../timeline/TimelineLoader';
import { registerTimelineAsset, registerTimelineTextureHandles } from '../../timeline/TimelinePlugin';

export class TimelineAssetLoader implements AssetLoader<TimelineResult> {
    readonly type = 'timeline';
    readonly extensions = ['.estimeline'];

    async load(path: string, ctx: LoadContext): Promise<TimelineResult> {
        const buildPath = ctx.catalog.getBuildPath(path);
        const text = await ctx.loadText(buildPath);
        const raw = JSON.parse(text);
        const asset = parseTimelineAsset(raw);
        const paths = extractTimelineAssetPaths(asset);

        const textureHandles = new Map<string, number>();
        for (const texPath of paths.textures) {
            try {
                const result = await ctx.loadTexture(texPath, true);
                textureHandles.set(texPath, result.handle);
            } catch (e) {
                console.warn(`[TimelineLoader] Failed to load texture: ${texPath}`, e);
                textureHandles.set(texPath, 0);
            }
        }

        registerTimelineAsset(path, asset);
        if (textureHandles.size > 0) {
            registerTimelineTextureHandles(path, textureHandles);
        }

        return { timelineId: path };
    }

    unload(_asset: TimelineResult): void {
        // Timeline assets registered globally
    }
}
