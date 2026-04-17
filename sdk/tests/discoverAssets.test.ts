import { describe, it, expect, beforeEach } from 'vitest';
import { defineComponent, clearUserComponents } from '../src/component';
import { discoverSceneAssets, getAssetPathsByType } from '../src/asset/discoverAssets';
import { AssetRegistry, makeUuidRef } from '../src/asset/AssetRegistry';
import type { SceneData } from '../src/scene';

const SPRITE_NAME = 'DiscoverTest_Sprite';
const AUDIO_NAME = 'DiscoverTest_Audio';
const SPINE_NAME = 'DiscoverTest_Spine';
const SM_NAME = 'DiscoverTest_StateMachine';

beforeEach(() => {
    clearUserComponents();

    defineComponent(SPRITE_NAME, {
        texture: '',
        material: '',
        color: { r: 1, g: 1, b: 1, a: 1 },
    }, {
        assetFields: [
            { field: 'texture', type: 'texture' },
            { field: 'material', type: 'material' },
        ],
    });

    defineComponent(AUDIO_NAME, {
        clip: '',
    }, {
        assetFields: [{ field: 'clip', type: 'audio' }],
    });

    defineComponent(SPINE_NAME, {
        skeleton: '',
        atlas: '',
    }, {
        spineFields: { skeletonField: 'skeleton', atlasField: 'atlas' },
    });

    defineComponent(SM_NAME, {
        states: {},
    }, {
        discoverAssets(data) {
            const refs: { type: string; path: string }[] = [];
            const states = data.states as Record<string, { timeline?: string }> | undefined;
            if (states) {
                for (const state of Object.values(states)) {
                    if (typeof state.timeline === 'string' && state.timeline) {
                        refs.push({ type: 'timeline', path: state.timeline });
                    }
                }
            }
            return refs;
        },
    });
});

function makeScene(entities: SceneData['entities']): SceneData {
    return { version: '1.0', name: 'test', entities };
}

describe('discoverSceneAssets', () => {
    it('discovers declarative asset fields', () => {
        const scene = makeScene([{
            id: 1, name: 'e1', parent: null, children: [],
            components: [{
                type: SPRITE_NAME,
                data: { texture: 'player.png', material: 'default.mat', color: { r: 1, g: 1, b: 1, a: 1 } },
            }],
        }]);

        const refs = discoverSceneAssets(scene);

        expect(getAssetPathsByType(refs, 'texture')).toEqual(new Set(['player.png']));
        expect(getAssetPathsByType(refs, 'material')).toEqual(new Set(['default.mat']));
    });

    it('discovers spine paired fields', () => {
        const scene = makeScene([{
            id: 1, name: 'e1', parent: null, children: [],
            components: [{
                type: SPINE_NAME,
                data: { skeleton: 'hero.skel', atlas: 'hero.atlas' },
            }],
        }]);

        const refs = discoverSceneAssets(scene);

        expect(refs.spines).toEqual([{ skeleton: 'hero.skel', atlas: 'hero.atlas' }]);
    });

    it('deduplicates spine pairs', () => {
        const scene = makeScene([
            {
                id: 1, name: 'e1', parent: null, children: [],
                components: [{ type: SPINE_NAME, data: { skeleton: 'hero.skel', atlas: 'hero.atlas' } }],
            },
            {
                id: 2, name: 'e2', parent: null, children: [],
                components: [{ type: SPINE_NAME, data: { skeleton: 'hero.skel', atlas: 'hero.atlas' } }],
            },
        ]);

        const refs = discoverSceneAssets(scene);

        expect(refs.spines).toHaveLength(1);
    });

    it('discovers custom discoverAssets callback', () => {
        const scene = makeScene([{
            id: 1, name: 'e1', parent: null, children: [],
            components: [{
                type: SM_NAME,
                data: { states: { idle: { timeline: 'idle.timeline' }, walk: { timeline: 'walk.timeline' } } },
            }],
        }]);

        const refs = discoverSceneAssets(scene);

        expect(getAssetPathsByType(refs, 'timeline')).toEqual(new Set(['idle.timeline', 'walk.timeline']));
    });

    it('skips invisible entities', () => {
        const scene = makeScene([{
            id: 1, name: 'hidden', parent: null, children: [], visible: false,
            components: [{
                type: SPRITE_NAME,
                data: { texture: 'hidden.png', material: '', color: { r: 1, g: 1, b: 1, a: 1 } },
            }],
        }]);

        const refs = discoverSceneAssets(scene);

        expect(getAssetPathsByType(refs, 'texture').size).toBe(0);
    });

    it('skips empty string values', () => {
        const scene = makeScene([{
            id: 1, name: 'e1', parent: null, children: [],
            components: [{
                type: SPRITE_NAME,
                data: { texture: '', material: '', color: { r: 1, g: 1, b: 1, a: 1 } },
            }],
        }]);

        const refs = discoverSceneAssets(scene);

        expect(getAssetPathsByType(refs, 'texture').size).toBe(0);
        expect(getAssetPathsByType(refs, 'material').size).toBe(0);
    });

    it('skips unknown component types', () => {
        const scene = makeScene([{
            id: 1, name: 'e1', parent: null, children: [],
            components: [{
                type: 'NonExistentComponent',
                data: { texture: 'foo.png' },
            }],
        }]);

        const refs = discoverSceneAssets(scene);

        expect(refs.byType.size).toBe(0);
        expect(refs.spines).toHaveLength(0);
    });

    it('aggregates from multiple entities and components', () => {
        const scene = makeScene([
            {
                id: 1, name: 'e1', parent: null, children: [],
                components: [
                    { type: SPRITE_NAME, data: { texture: 'a.png', material: 'mat1.mat', color: { r: 1, g: 1, b: 1, a: 1 } } },
                    { type: AUDIO_NAME, data: { clip: 'bgm.mp3' } },
                ],
            },
            {
                id: 2, name: 'e2', parent: null, children: [],
                components: [
                    { type: SPRITE_NAME, data: { texture: 'b.png', material: 'mat1.mat', color: { r: 1, g: 1, b: 1, a: 1 } } },
                ],
            },
        ]);

        const refs = discoverSceneAssets(scene);

        expect(getAssetPathsByType(refs, 'texture')).toEqual(new Set(['a.png', 'b.png']));
        expect(getAssetPathsByType(refs, 'material')).toEqual(new Set(['mat1.mat']));
        expect(getAssetPathsByType(refs, 'audio')).toEqual(new Set(['bgm.mp3']));
    });

    it('returns empty for empty scene', () => {
        const scene = makeScene([]);

        const refs = discoverSceneAssets(scene);

        expect(refs.byType.size).toBe(0);
        expect(refs.spines).toHaveLength(0);
    });
});

describe('discoverSceneAssets with UUID refResolver', () => {
    const UUID_PLAYER = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    const UUID_LOGO   = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
    const UUID_MAT    = 'cccccccc-3333-4333-8333-cccccccccccc';
    const UUID_MUSIC  = 'dddddddd-4444-4444-8444-dddddddddddd';
    const UUID_MISSING = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';

    function makeRegistry(): AssetRegistry {
        const reg = new AssetRegistry();
        reg.addEntry({ uuid: UUID_PLAYER, path: 'assets/player.png',  type: 'texture' });
        reg.addEntry({ uuid: UUID_LOGO,   path: 'assets/logo.png',    type: 'texture' });
        reg.addEntry({ uuid: UUID_MAT,    path: 'assets/mat1.mat',    type: 'material' });
        reg.addEntry({ uuid: UUID_MUSIC,  path: 'assets/bgm.mp3',     type: 'audio' });
        return reg;
    }

    it('resolves @uuid: refs to current paths before bucketing', () => {
        const reg = makeRegistry();
        const scene = makeScene([{
            id: 1, name: 'e1', parent: null, children: [],
            components: [{
                type: SPRITE_NAME,
                data: {
                    texture:  makeUuidRef(UUID_PLAYER),
                    material: makeUuidRef(UUID_MAT),
                    color: { r: 1, g: 1, b: 1, a: 1 },
                },
            }],
        }]);

        const refs = discoverSceneAssets(scene, (ref) => reg.resolveRef(ref));

        expect(getAssetPathsByType(refs, 'texture')).toEqual(new Set(['assets/player.png']));
        expect(getAssetPathsByType(refs, 'material')).toEqual(new Set(['assets/mat1.mat']));
        expect(refs.unresolved).toEqual([]);
    });

    it('passes plain path strings through unchanged (legacy)', () => {
        const reg = makeRegistry();
        const scene = makeScene([{
            id: 1, name: 'e1', parent: null, children: [],
            components: [{
                type: SPRITE_NAME,
                data: { texture: 'assets/legacy.png', material: '', color: { r: 1, g: 1, b: 1, a: 1 } },
            }],
        }]);

        const refs = discoverSceneAssets(scene, (ref) => reg.resolveRef(ref));

        expect(getAssetPathsByType(refs, 'texture')).toEqual(new Set(['assets/legacy.png']));
    });

    it('mixes @uuid: and plain-path refs in the same scene', () => {
        const reg = makeRegistry();
        const scene = makeScene([
            {
                id: 1, name: 'e1', parent: null, children: [],
                components: [{
                    type: SPRITE_NAME,
                    data: {
                        texture:  makeUuidRef(UUID_PLAYER),
                        material: 'assets/legacy.mat',
                        color: { r: 1, g: 1, b: 1, a: 1 },
                    },
                }],
            },
            {
                id: 2, name: 'e2', parent: null, children: [],
                components: [{
                    type: AUDIO_NAME,
                    data: { clip: makeUuidRef(UUID_MUSIC) },
                }],
            },
        ]);

        const refs = discoverSceneAssets(scene, (ref) => reg.resolveRef(ref));

        expect(getAssetPathsByType(refs, 'texture')).toEqual(new Set(['assets/player.png']));
        expect(getAssetPathsByType(refs, 'material')).toEqual(new Set(['assets/legacy.mat']));
        expect(getAssetPathsByType(refs, 'audio')).toEqual(new Set(['assets/bgm.mp3']));
    });

    it('records unknown UUID refs in `unresolved` and excludes them from bucketing', () => {
        const reg = makeRegistry();
        const scene = makeScene([{
            id: 1, name: 'e1', parent: null, children: [],
            components: [{
                type: SPRITE_NAME,
                data: {
                    texture:  makeUuidRef(UUID_MISSING),
                    material: makeUuidRef(UUID_MAT),
                    color: { r: 1, g: 1, b: 1, a: 1 },
                },
            }],
        }]);

        const refs = discoverSceneAssets(scene, (ref) => reg.resolveRef(ref));

        expect(getAssetPathsByType(refs, 'texture').size).toBe(0);
        expect(getAssetPathsByType(refs, 'material')).toEqual(new Set(['assets/mat1.mat']));
        expect(refs.unresolved).toEqual([makeUuidRef(UUID_MISSING)]);
    });

    it('resolves spineFields via the same resolver', () => {
        const reg = new AssetRegistry();
        const UUID_SKEL = '11111111-1111-4111-8111-111111111111';
        const UUID_ATLAS = '22222222-2222-4222-8222-222222222222';
        reg.addEntry({ uuid: UUID_SKEL,  path: 'assets/hero.skel',  type: 'spine' });
        reg.addEntry({ uuid: UUID_ATLAS, path: 'assets/hero.atlas', type: 'spine' });

        const scene = makeScene([{
            id: 1, name: 'e1', parent: null, children: [],
            components: [{
                type: SPINE_NAME,
                data: {
                    skeleton: makeUuidRef(UUID_SKEL),
                    atlas:    makeUuidRef(UUID_ATLAS),
                },
            }],
        }]);

        const refs = discoverSceneAssets(scene, (ref) => reg.resolveRef(ref));

        expect(refs.spines).toEqual([{ skeleton: 'assets/hero.skel', atlas: 'assets/hero.atlas' }]);
    });
});
