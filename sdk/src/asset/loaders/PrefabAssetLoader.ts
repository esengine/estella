import type { AssetLoader, LoadContext, PrefabResult } from '../AssetLoader';
import { migratePrefabData } from '../../prefab';
import { log } from '../../logger';

export class PrefabAssetLoader implements AssetLoader<PrefabResult> {
    readonly type = 'prefab';
    readonly extensions = ['.esprefab'];

    async load(path: string, ctx: LoadContext): Promise<PrefabResult> {
        const buildPath = ctx.catalog.getBuildPath(path);
        const text = await ctx.loadText(buildPath);
        const raw = JSON.parse(text) as unknown;
        const { data, migrated, fromVersion, toVersion } = migratePrefabData(raw);
        if (migrated) {
            log.info(
                'prefab',
                `migrated "${path}" ${fromVersion} → ${toVersion} (legacy numeric ids → strings). Re-save to persist.`,
            );
        }
        return { data };
    }

    unload(_asset: PrefabResult): void {
        // Prefab data is plain JSON, no GPU resources
    }
}
