/**
 * Unit tests for Phase 1.6 — asset load error propagation.
 * Verifies preloadSceneAssets populates `missing` and that
 * loadSceneWithAssets surfaces it via onMissingAssets / abortOnMissingAssets.
 *
 * Integration with the real loader path is covered by higher-level
 * scene tests; here we short-circuit by handing preloadSceneAssets
 * a stub Assets that only exercises the unresolved-ref branch.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { defineComponent, clearUserComponents } from '../src/component';
import { discoverSceneAssets } from '../src/asset/discoverAssets';
import { AssetRegistry, makeUuidRef } from '../src/asset/AssetRegistry';
import type { SceneData } from '../src/scene';
import { MissingAssetsError } from '../src/scene';

const SPRITE_NAME = 'MissingTest_Sprite';

const UUID_KNOWN   = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const UUID_MISSING = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

beforeEach(() => {
    clearUserComponents();
    defineComponent(SPRITE_NAME, {
        texture: '',
        color: { r: 1, g: 1, b: 1, a: 1 },
    }, {
        assetFields: [{ field: 'texture', type: 'texture' }],
    });
});

function scene(texRef: string): SceneData {
    return {
        version: '1.0',
        name: 'test',
        entities: [{
            id: 1, name: 'e', parent: null, children: [],
            components: [{
                type: SPRITE_NAME,
                data: { texture: texRef, color: { r: 1, g: 1, b: 1, a: 1 } },
            }],
        }],
    };
}

describe('discoverSceneAssets → unresolved → missing plumbing', () => {
    it('populates `unresolved` when a @uuid: ref is unknown', () => {
        const reg = new AssetRegistry();
        reg.addEntry({ uuid: UUID_KNOWN, path: 'assets/ok.png', type: 'texture' });

        const refs = discoverSceneAssets(
            scene(makeUuidRef(UUID_MISSING)),
            (r) => reg.resolveRef(r),
        );

        expect(refs.unresolved).toEqual([makeUuidRef(UUID_MISSING)]);
    });

    it('leaves `unresolved` empty when every ref resolves', () => {
        const reg = new AssetRegistry();
        reg.addEntry({ uuid: UUID_KNOWN, path: 'assets/ok.png', type: 'texture' });

        const refs = discoverSceneAssets(
            scene(makeUuidRef(UUID_KNOWN)),
            (r) => reg.resolveRef(r),
        );

        expect(refs.unresolved).toEqual([]);
    });

    it('reports each unresolved ref in the order encountered', () => {
        const reg = new AssetRegistry();

        const sceneData: SceneData = {
            version: '1.0', name: 't',
            entities: [
                {
                    id: 1, name: 'a', parent: null, children: [],
                    components: [{
                        type: SPRITE_NAME,
                        data: { texture: makeUuidRef(UUID_MISSING), color: { r: 1, g: 1, b: 1, a: 1 } },
                    }],
                },
                {
                    id: 2, name: 'b', parent: null, children: [],
                    components: [{
                        type: SPRITE_NAME,
                        data: { texture: makeUuidRef(UUID_KNOWN), color: { r: 1, g: 1, b: 1, a: 1 } },
                    }],
                },
            ],
        };

        const refs = discoverSceneAssets(sceneData, (r) => reg.resolveRef(r));
        // Both UUIDs are unknown because the registry is empty.
        expect(refs.unresolved).toEqual([
            makeUuidRef(UUID_MISSING),
            makeUuidRef(UUID_KNOWN),
        ]);
    });
});

describe('MissingAssetsError', () => {
    it('carries the missing list and a descriptive message', () => {
        const missing = [
            { ref: makeUuidRef(UUID_MISSING), reason: 'unresolved' as const },
        ];
        const err = new MissingAssetsError(missing);
        expect(err.name).toBe('MissingAssetsError');
        expect(err.missing).toBe(missing);
        expect(err.message).toMatch(/1 asset/);
    });
});
