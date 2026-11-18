// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it, vi } from 'vitest';
import type { App } from '../src/app/app';
import { Quality, installQuality, qualityProfileOf } from '../src/render/qualityRuntime';
import { defaultQualityProfile, resolveQualityProfile, type QualityLevel } from '../src/render/quality';
import { QUALITY_SETTINGS, parseQualitySetting, qualityEffectUniforms, type QualitySetting } from '../src/render/qualitySettings/index';
import { waterQualityOf, FULL_WATER } from '../src/water/waterPlugin';
import { textureStreamingOptionsOf, TEXTURE_STREAMING_DEFAULTS } from '../src/render/textureStreaming';
import { selectSphereNodes, levelsFor } from '../src/terrain/sphere';
import { CAUSTICS_GLSL } from '../src/render/waterCaustics';
import { waterReflectionGrowth } from '../src/water/waterShader';
import { RUNTIME_BUILD_DEFAULTS, RuntimeConfig, applyBuildRuntimeConfig, parseRuntimeBuildConfig } from '../src/defaults';
import { worldgenLimits, WORLDGEN_LIMIT_DEFAULTS } from '../src/worldgen/limits';

vi.mock('../src/platform', async (original) => ({
    ...(await original<typeof import('../src/platform')>()),
    getPlatform: () => ({ deviceName: () => 'desktop', deviceQualityInfo: () => ({ memoryGB: 8, cores: 8 }) }),
    platformNow: () => 1,
    platformOnAppHide: () => () => {}, platformOnAppShow: () => () => {},
}));
vi.mock('../src/ecs/bridge/engineApi', () => ({
    engineApi: () => ({ renderer_setLodDistanceScale: lodScale, renderer_setOcclusionGridSize: occlusionGrid, renderer_setTargetPoolIdleBudget: targetIdle }),
}));

const { lodScale, occlusionGrid, targetIdle } = vi.hoisted(() => ({ lodScale: vi.fn(), occlusionGrid: vi.fn(), targetIdle: vi.fn() }));

const LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high'];
const MINE = ['viewDistance', 'terrain', 'water', 'textures'];
const byKey = (key: string): QualitySetting => (QUALITY_SETTINGS as readonly QualitySetting[]).find((s) => s.key === key)!;

const FORMER = {
    lodDistanceScale: 1, occlusionGridSize: 64, batchScanFrames: 30,
    terrainSurfaceTexels: 256, terrainSurfacesPerFrame: 2, terrainAtlasSize: 2048, planetDrawLevels: 12, voxelRebuildBudgetMs: 4,
    plantInteractionActive: 512, plantInteractionPerFrame: 48,
    waterShaftSteps: 24, waterReflectionSteps: 20, waterCausticLayers: 3,
    textureStreamingMinEdge: 64, textureStreamingShrinkMs: 3000, textureStreamingUnseenMs: 5000,
    textureStreamingIntervalMs: 250, textureStreamingInFlight: 4, textureStreamingStartEdge: 256,
    renderTargetIdleMB: 256, terrainTileBudgetMB: 256,
};

function fakeApp(): { app: App; apply: () => void; controller: () => import('../src/render/quality').QualityController } {
    let apply: (() => void) | undefined;
    let controller: import('../src/render/quality').QualityController | undefined;
    const app = {
        wasmModule: null, insertResource: (_: unknown, value: typeof controller) => { controller = value; },
        hasResource: (r: unknown) => r === Quality && controller !== undefined, getResource: () => controller,
        pipeline: { setQuality: (_: unknown, callback: () => void) => { apply = callback; } },
        addPlugin: vi.fn(), onFrameEnd: () => () => {},
    } as unknown as App;
    return { app, apply: () => apply!(), controller: () => controller! };
}

describe('view distance, terrain, water and texture settings', () => {
    it('keep at High the values the engine was written with', () => {
        const high = defaultQualityProfile('high') as unknown as Record<string, unknown>;
        for (const [key, value] of Object.entries(FORMER)) expect(high[key], key).toBe(value);
    });

    it('never ask more of a lower level than of a higher one', () => {
        const longerIsCheaper = new Set(['batchScanFrames', 'textureStreamingIntervalMs']);
        for (const key of Object.keys(FORMER)) {
            const s = byKey(key);
            expect(MINE).toContain(s.group);
            const [low, medium, high] = LEVELS.map((l) => (longerIsCheaper.has(key) ? -1 : 1) * (s.defaults[l] as number));
            expect(low, key).toBeLessThanOrEqual(medium!);
            expect(medium, key).toBeLessThanOrEqual(high!);
        }
    });

    it('hold a written value to its range, and a loop count to the size its shader was compiled for', () => {
        expect(parseQualitySetting(byKey('waterShaftSteps'), 99, 8)).toBe(24);
        expect(parseQualitySetting(byKey('waterShaftSteps'), 0, 8)).toBe(1);
        expect(parseQualitySetting(byKey('waterReflectionSteps'), 64, 8)).toBe(20);
        expect(parseQualitySetting(byKey('waterCausticLayers'), 7, 2)).toBe(3);
        expect(parseQualitySetting(byKey('planetDrawLevels'), 20, 10)).toBe(12);
        expect(parseQualitySetting(byKey('lodDistanceScale'), 0.01, 1)).toBe(0.25);
        expect(parseQualitySetting(byKey('occlusionGridSize'), 48, 64)).toBe(64);
        expect(parseQualitySetting(byKey('terrainAtlasSize'), 4096, 2048)).toBe(2048);
        expect(parseQualitySetting(byKey('textureStreamingIntervalMs'), 1, 250)).toBe(50);
        expect(parseQualitySetting(byKey('batchScanFrames'), 12.6, 30)).toBe(13);
        expect(resolveQualityProfile('low', { voxelRebuildBudgetMs: 100 }).voxelRebuildBudgetMs).toBe(16);
    });
});

describe('what reaches the renderer', () => {
    it('hands the level\'s LOD scale, occlusion grid and idle target budget to the renderer, and the High values with the quality system off', () => {
        const { app, apply, controller } = fakeApp();
        installQuality(app, { mode: 'low', profiles: { low: { occlusionGridSize: 32 } } }, 4);
        expect(lodScale).toHaveBeenLastCalledWith(0.6);
        expect(occlusionGrid).toHaveBeenLastCalledWith(32);
        expect(targetIdle).toHaveBeenLastCalledWith(64);
        controller().setMode('medium'); apply();
        expect(lodScale).toHaveBeenLastCalledWith(0.8);
        expect(targetIdle).toHaveBeenLastCalledWith(128);
        controller().setMode('off'); apply();
        expect(lodScale).toHaveBeenLastCalledWith(1);
        expect(occlusionGrid).toHaveBeenLastCalledWith(64);
        expect(targetIdle).toHaveBeenLastCalledWith(256);
    });

    it('reads the active level in the plugins, and High where no quality policy runs', () => {
        const { app, controller } = fakeApp();
        expect(qualityProfileOf(app).voxelRebuildBudgetMs).toBe(4);
        installQuality(app, { mode: 'low', profiles: { low: { voxelRebuildBudgetMs: 1.5 } } }, 4);
        expect(qualityProfileOf(app).voxelRebuildBudgetMs).toBe(1.5);
        controller().setMode('off');
        expect(qualityProfileOf(app).voxelRebuildBudgetMs).toBe(4);
    });

    it('gives the underwater effect its shaft steps and caustic layers as uniforms', () => {
        expect(qualityEffectUniforms(defaultQualityProfile('low'), 'underwater')).toEqual([['u_shaftSteps', 12], ['u_causticLayers', 2]]);
        expect(qualityEffectUniforms(resolveQualityProfile('high', { waterShaftSteps: 5 }), 'underwater')).toContainEqual(['u_shaftSteps', 5]);
    });

    it('gives the water surface its reflection steps and caustic layers, all of them where nothing manages it', () => {
        expect(waterQualityOf(defaultQualityProfile('low'), false)).toMatchObject({ reflectionSteps: 8, causticLayers: 2 });
        expect(waterQualityOf(defaultQualityProfile('medium'), false)).toMatchObject({ reflectionSteps: 12, causticLayers: 3 });
        expect(FULL_WATER).toMatchObject({ reflectionSteps: 20, causticLayers: 3 });
    });

    it('streams textures by the level\'s sizes and delays, and by the old ones at High', () => {
        expect(textureStreamingOptionsOf(defaultQualityProfile('low'))).toEqual({ minEdge: 32, budgetBytes: 128 * 1024 * 1024, shrinkAfter: 2000, unseenAfter: 3000 });
        const high = textureStreamingOptionsOf(defaultQualityProfile('high'));
        expect({ ...high, budgetBytes: 0 }).toEqual(TEXTURE_STREAMING_DEFAULTS);
    });
});

describe('the shaders stop where the level says', () => {
    it('lays only the asked layers of caustics, up to the three compiled in', () => {
        expect(CAUSTICS_GLSL).toContain('float causticPattern(vec2 p, float t, float layers)');
        expect(CAUSTICS_GLSL).toMatch(/for \(int i = 0; i < 3; \+\+i\) \{\s+if \(float\(i\) >= layers\) break;/);
    });
});

describe('a reflection with fewer steps', () => {
    it('lengthens each step instead of stopping short, so it reaches as far as the twenty steps of High', () => {
        const reach = (g: number, n: number): number => (g ** n - 1) / (g - 1);
        expect(waterReflectionGrowth(20)).toBe(1.25);
        for (const n of [8, 12, 16]) {
            const g = waterReflectionGrowth(n);
            expect(g).toBeGreaterThan(1.25);
            expect(reach(g, n) / reach(1.25, 20)).toBeCloseTo(1, 4);
        }
        expect(waterReflectionGrowth(1)).toBe(4);
    });
});

describe('a planet drawn no finer than the level allows', () => {
    const planet = { radius: 6000, minHeight: 0, maxHeight: 100, leafSize: 16, range0: 40 };
    const levels = levelsFor(planet.radius, planet.leafSize);
    const eye: [number, number, number] = [0, planet.radius + 2, 0];

    it('stops splitting at the floor it is given, and covers the planet the same', () => {
        const all = selectSphereNodes(planet, ...eye, levels);
        const capped = selectSphereNodes(planet, ...eye, levels, 3);
        expect(Math.min(...all.map((n) => n.level))).toBe(0);
        expect(Math.min(...capped.map((n) => n.level))).toBe(3);
        expect(capped.length).toBeLessThan(all.length);
        const area = (nodes: typeof all) => nodes.reduce((sum, n) => sum + 4 ** n.level, 0);
        expect(area(capped)).toBe(area(all));
    });
});

describe('loading and streaming, a project setting and not a level', () => {
    it('keeps only what differs from the engine\'s values, held to range', () => {
        expect(parseRuntimeBuildConfig({ chunksInFlight: 16, preloadConcurrency: 3, worldPlansKept: 5000 })).toEqual({ preloadConcurrency: 3, worldPlansKept: 1024 });
        expect(RUNTIME_BUILD_DEFAULTS).toMatchObject({ chunksInFlight: 16, preloadConcurrency: 6, terrainPagesInFlight: 16, planetTilesKept: 6000, worldPlanCacheLimit: 40000, worldPlansKept: 24 });
    });

    it('reaches the loaders and the world planners, and goes back to the defaults when a project says nothing', () => {
        const app = { setMaxDeltaTime: vi.fn(), setMaxFixedSteps: vi.fn() };
        applyBuildRuntimeConfig(app, { chunksInFlight: 4, terrainPagesInFlight: 2, planetTilesKept: 500, worldPlanCacheLimit: 2000, worldPlansKept: 3 });
        expect(RuntimeConfig).toMatchObject({ chunksInFlight: 4, terrainPagesInFlight: 2, preloadConcurrency: 6 });
        expect(worldgenLimits()).toEqual({ tilesKept: 500, cacheLimit: 2000, plansKept: 3 });
        applyBuildRuntimeConfig(app, {});
        expect(RuntimeConfig.chunksInFlight).toBe(16);
        expect(worldgenLimits()).toEqual(WORLDGEN_LIMIT_DEFAULTS);
    });
});
