import type { AssetLoader, LoadContext, PrefabResult } from '../AssetLoader';
import type { PrefabData } from '../../prefab';

export class PrefabAssetLoader implements AssetLoader<PrefabResult> {
    readonly type = 'prefab';
    readonly extensions = ['.esprefab'];

    async load(path: string, ctx: LoadContext): Promise<PrefabResult> {
        const buildPath = ctx.catalog.getBuildPath(path);
        const text = await ctx.loadText(buildPath);
        const data = JSON.parse(text) as PrefabData;
        return { data };
    }

    unload(_asset: PrefabResult): void {
        // Prefab data is plain JSON, no GPU resources
    }
}
