// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    hot-update-rebind.test.ts
 * @brief   A hot update reaches every field that declares an asset, not the two
 *          the rebinder's author remembered.
 *
 * @details Seven built-in fields carry a texture; the rebinder knew `Sprite.texture`
 *          and `MeshRenderer.texture`. The other five — and every project or plugin
 *          component — kept rendering the pre-update image with nothing reporting a
 *          failure. The cases here are DERIVED from `component.assetFields`, so a
 *          field added tomorrow is covered tomorrow rather than when someone
 *          remembers to extend a list.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App } from '../src/app/app';
import { World } from '../src/ecs/world';
import { defineComponent, getComponentRegistry, type AnyComponentDef } from '../src/ecs/component';
import { COMPONENT_META } from '../src/ecs/component.generated';
import { Assets } from '../src/asset/Assets';
import type { Backend } from '../src/asset/Backend';
import type { CppRegistry } from '../src/wasm';
import type { Entity } from '../src/types';
import { ensureBuiltinComponentsRegistered } from '../src/ecs/component';
import { installHotUpdateRebind } from '../src/hotUpdateRebind';
import { findLiveAssetBindings } from '../src/asset/liveAssetBindings';

// ---------------------------------------------------------------------------
// The C++ side, modelled: a component store that add/get/has/remove really move.
// ---------------------------------------------------------------------------

function connectFakeCpp(world: World): void {
    let nextEntity = 1;
    const registry: Record<string, unknown> = {
        create: () => nextEntity++,
        destroy: () => {},
        hasParent: () => false,
        setParent: () => {},
    };
    for (const name of Object.keys(COMPONENT_META)) {
        const rows = new Map<number, Record<string, unknown>>();
        registry[`add${name}`] = (e: number, data: Record<string, unknown>) => { rows.set(e, { ...data }); };
        registry[`get${name}`] = (e: number) => rows.get(e);
        registry[`has${name}`] = (e: number) => rows.has(e);
        registry[`remove${name}`] = (e: number) => { rows.delete(e); };
    }
    world.connectCpp(registry as unknown as CppRegistry);
}

/** The pool, modelled: every decode mints a handle, invalidate severs revival. */
function createPoolFake() {
    const byPath = new Map<string, number>();
    let next = 1;
    return {
        budget: 0,
        createTexture: vi.fn((): number => next++),
        registerTextureWithPath: vi.fn((handle: number, path: string) => { byPath.set(path, handle); }),
        acquireTextureByPath: vi.fn((path: string): number => byPath.get(path) ?? 0),
        invalidateTexturePath: vi.fn((path: string): boolean => byPath.delete(path)),
        releaseTexture: vi.fn(),
        getTextureDimensions: vi.fn(() => ({ width: 64, height: 64 })),
        getTextureGLId: vi.fn(() => 1),
        setTextureMetadata: vi.fn(),
    };
}

let pool = createPoolFake();
vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => pool,
    getResourceManager: () => pool,
    evictTextureDimensions: vi.fn(),
}));

const platformFactory = vi.hoisted(() => () => ({
    platformCreateCanvas: () => ({
        width: 64, height: 64,
        getContext: () => ({
            clearRect: vi.fn(), drawImage: vi.fn(),
            getImageData: () => ({ data: { buffer: new ArrayBuffer(64 * 64 * 4) } }),
        }),
    }),
    platformCreateImage: () => {
        const img: { width?: number; height?: number; onload?: () => void } = {};
        setTimeout(() => { img.width = 64; img.height = 64; img.onload?.(); }, 0);
        return img;
    },
    platformFetch: vi.fn(),
    platformReadFile: vi.fn(),
    platformReadTextFile: vi.fn(),
    platformFileExists: vi.fn(),
    platformLoadSubpackage: vi.fn(async () => {}),
    platformGetStorageItem: () => null,
    platformSetStorageItem: vi.fn(),
    platformWriteCacheFile: vi.fn(async () => {}),
}));
vi.mock('../src/platform', platformFactory);
vi.mock('../src/platform/base', platformFactory);

function buildAssets(): Assets {
    return Assets.create({
        backend: {
            fetchBinary: vi.fn(async () => new ArrayBuffer(8)),
            fetchText: vi.fn(async () => '{}'),
            resolveUrl: (p: string) => `http://test/${p}`,
        } as unknown as Backend,
        module: { _malloc: vi.fn(() => 0), _free: vi.fn(), HEAPU8: new Uint8Array(1 << 16), GL: null, FS: null } as never,
    });
}

// What every SDK entry does at load: register the engine's whole component
// catalogue. Without it the registry holds only what this test file happened to
// import, and the completeness check below would be measuring the imports.
ensureBuiltinComponentsRegistered();

/** Every (component, field) in the live registry that binds a texture. */
function declaredTextureFields(): Array<{ component: AnyComponentDef; field: string }> {
    const out: Array<{ component: AnyComponentDef; field: string }> = [];
    for (const component of getComponentRegistry().values()) {
        for (const f of component.assetFields) {
            if (f.type === 'texture') out.push({ component, field: f.field });
        }
    }
    return out;
}

/** Run frames until the reload's promise has landed and its swap been applied. */
async function settle(app: App, frames = 4): Promise<void> {
    for (let i = 0; i < frames; i++) {
        await app.tick(1 / 60);
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
    }
}

describe('the hot-update rebinder reaches every declared texture field', () => {
    beforeEach(() => { pool = createPoolFake(); });

    it('rebinds all of them, including a component the project declared', async () => {
        // A project component is the case a hand-written list can never cover.
        const CustomVisual = defineComponent(
            'HotUpdateRebindTestVisual',
            { icon: 0, tint: 1 },
            { assetFields: [{ field: 'icon', type: 'texture' }] },
        );

        const app = App.new();
        connectFakeCpp(app.world);
        const assets = buildAssets();
        installHotUpdateRebind(app, assets);

        const before = await assets.loadTexture('hero.png');
        const fields = declaredTextureFields();
        // Completeness, against the engine's own declaration rather than a list
        // kept here: a texture field added to a C++ component and not covered
        // below fails this, instead of quietly going unrebound.
        const covered = new Set(fields.map((f) => `${f.component._name}.${f.field}`));
        const engineDeclared = Object.entries(COMPONENT_META).flatMap(([name, meta]) =>
            (meta.assetFields ?? [])
                .filter((f) => f.type === 'texture')
                .map((f) => `${name}.${f.field}`));
        expect(engineDeclared.length).toBeGreaterThanOrEqual(7);   // never vacuous
        expect([...covered]).toEqual(expect.arrayContaining(engineDeclared));
        expect(covered.has('HotUpdateRebindTestVisual.icon')).toBe(true);

        const bound: Array<{ entity: Entity; component: AnyComponentDef; field: string }> = [];
        for (const { component, field } of fields) {
            const entity = app.world.spawn();
            app.world.insert(entity, component, { [field]: before.handle } as never);
            bound.push({ entity, component, field });
        }
        // And one field of each kind left unbound, which a swap must not touch.
        const untouched = app.world.spawn();
        app.world.insert(untouched, CustomVisual, {});

        assets.invalidate('hero.png');
        await settle(app);

        const after = assets.getTexture('hero.png');
        expect(after).toBeDefined();
        expect(after!.handle).not.toBe(before.handle);

        for (const { entity, component, field } of bound) {
            const data = app.world.get(entity, component) as Record<string, unknown>;
            expect(`${component._name}.${field} = ${String(data[field])}`)
                .toBe(`${component._name}.${field} = ${after!.handle}`);
        }
        expect((app.world.get(untouched, CustomVisual) as { icon: number }).icon).toBe(0);
    });

    it('an unbound field is not a binding of the asset being replaced', () => {
        // 0 is what an unbound field holds; matching it would rebind the whole world.
        const world = new World();
        connectFakeCpp(world);
        const Widget = defineComponent(
            'HotUpdateRebindTestWidget', { icon: 0 },
            { assetFields: [{ field: 'icon', type: 'texture' }] },
        );
        const e = world.spawn();
        world.insert(e, Widget, {});

        expect(findLiveAssetBindings(world, 'texture', 0)).toEqual([]);
        expect(findLiveAssetBindings(world, 'texture', 7)).toEqual([]);
        world.insert(e, Widget, { icon: 7 });
        expect(findLiveAssetBindings(world, 'texture', 7)).toHaveLength(1);
    });
});
