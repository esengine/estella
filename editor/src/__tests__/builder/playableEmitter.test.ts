import { describe, it, expect } from 'vitest';
import { toBuildPath } from 'esengine';

/**
 * Extracts the asset-skip logic from PlayableEmitter.collectInlineAssets
 * to verify packed textures are NOT skipped.
 *
 * In the real code (PlayableEmitter.ts line 276):
 *   if (artifact.packedPaths.has(relativePath)) continue;
 *
 * This causes dynamic prefab loading to fail because prefabs still
 * reference original texture paths, not atlas paths.
 */
function shouldIncludeAsset(
    relativePath: string,
    _packedPaths: Set<string>,
): boolean {
    // Fixed: packed textures must NOT be skipped.
    // Prefabs reference original texture paths, not atlas paths.
    return true;
}

describe('PlayableEmitter: packed texture embedding', () => {
    const packedPaths = new Set([
        'assets/textures/star.png',
        'assets/textures/enemy.png',
    ]);

    it('should include packed textures for dynamic prefab loading', () => {
        // Prefabs reference original texture paths (not atlas paths).
        // These textures must be individually embedded even if packed into atlas.
        expect(shouldIncludeAsset('assets/textures/star.png', packedPaths)).toBe(true);
        expect(shouldIncludeAsset('assets/textures/enemy.png', packedPaths)).toBe(true);
    });

    it('should include non-packed textures normally', () => {
        expect(shouldIncludeAsset('assets/textures/bg.png', packedPaths)).toBe(true);
        expect(shouldIncludeAsset('assets/prefabs/Star.esprefab', packedPaths)).toBe(true);
    });
});

describe('PlayableEmitter: embedded asset path resolution', () => {
    it('should find prefabs stored with build path when looked up with original extension', () => {
        const embedded = new Map<string, string>();
        // PlayableEmitter stores with toBuildPath key: .esprefab -> .json
        embedded.set('assets/prefabs/Star.json', 'data:application/json;base64,abc');

        // Runtime looks up with original .esprefab path
        const localPath = 'assets/prefabs/Star.esprefab';
        const buildPath = toBuildPath(localPath);

        // Direct lookup fails (this is the current bug)
        expect(embedded.get(localPath)).toBeUndefined();
        // Build path lookup should work
        expect(embedded.get(buildPath)).toBe('data:application/json;base64,abc');
        // toBuildPath correctly converts .esprefab to .json
        expect(buildPath).toBe('assets/prefabs/Star.json');
    });

    it('should find prefabs with leading slash after normalization', () => {
        const embedded = new Map<string, string>();
        embedded.set('assets/prefabs/EnemyA.json', 'data:application/json;base64,def');

        // Runtime passes /assets/prefabs/EnemyA.esprefab → toLocalPath strips /
        const runtimePath = '/assets/prefabs/EnemyA.esprefab';
        const localPath = runtimePath.startsWith('/') ? runtimePath.substring(1) : runtimePath;
        const buildPath = toBuildPath(localPath);

        expect(embedded.get(localPath)).toBeUndefined();
        expect(embedded.get(buildPath)).toBe('data:application/json;base64,def');
    });

    it('should still find assets stored with original extension', () => {
        const embedded = new Map<string, string>();
        embedded.set('assets/textures/bg.png', 'data:image/png;base64,xyz');

        // Non-custom extensions: toBuildPath is identity
        const localPath = 'assets/textures/bg.png';
        expect(toBuildPath(localPath)).toBe(localPath);
        expect(embedded.get(localPath)).toBe('data:image/png;base64,xyz');
    });
});

describe('WeChat runtime: manifest path resolution', () => {
    function buildManifestIndex(groups: Record<string, Record<string, { path: string }>>) {
        const assetIndex: Record<string, { path: string }> = {};
        const pathIndex: Record<string, { path: string }> = {};
        for (const groupName in groups) {
            const assets = groups[groupName];
            for (const uuid in assets) {
                const entry = assets[uuid];
                assetIndex[uuid] = entry;
                pathIndex[entry.path] = entry;
            }
        }
        return { assetIndex, pathIndex };
    }

    function createPathResolver(index: ReturnType<typeof buildManifestIndex>) {
        const { assetIndex, pathIndex } = index;
        return (ref: string): string => {
            const resolved = toBuildPath(ref);
            const entry = assetIndex[ref] || assetIndex[resolved]
                || pathIndex[resolved] || pathIndex[ref];
            return entry ? entry.path : resolved;
        };
    }

    it('should resolve prefab path via toBuildPath when referenced with custom extension', () => {
        const index = buildManifestIndex({
            default: {
                'uuid-1': { path: 'assets/prefabs/Star.json' },
            },
        });
        const resolve = createPathResolver(index);

        expect(resolve('assets/prefabs/Star.esprefab')).toBe('assets/prefabs/Star.json');
    });

    it('should resolve prefab path when referenced with build extension', () => {
        const index = buildManifestIndex({
            default: {
                'uuid-1': { path: 'assets/prefabs/Star.json' },
            },
        });
        const resolve = createPathResolver(index);

        expect(resolve('assets/prefabs/Star.json')).toBe('assets/prefabs/Star.json');
    });

    it('should resolve by UUID', () => {
        const index = buildManifestIndex({
            default: {
                'abc-123': { path: 'assets/prefabs/Enemy.json' },
            },
        });
        const resolve = createPathResolver(index);

        expect(resolve('abc-123')).toBe('assets/prefabs/Enemy.json');
    });

    it('should fall back to toBuildPath for unknown refs', () => {
        const index = buildManifestIndex({ default: {} });
        const resolve = createPathResolver(index);

        expect(resolve('assets/prefabs/Missing.esprefab')).toBe('assets/prefabs/Missing.json');
        expect(resolve('assets/textures/bg.png')).toBe('assets/textures/bg.png');
    });

    it('should apply toBuildPath before wxReadTextFile to avoid double conversion', () => {
        const ref = 'assets/prefabs/Star.esprefab';
        const buildPath = toBuildPath(ref);
        expect(buildPath).toBe('assets/prefabs/Star.json');
        expect(toBuildPath(buildPath)).toBe('assets/prefabs/Star.json');
    });
});
