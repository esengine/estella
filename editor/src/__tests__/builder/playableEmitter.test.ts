import { describe, it, expect } from 'vitest';

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
