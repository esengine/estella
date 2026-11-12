// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A generated world in a running app with no renderer (a server): interactive placements are entities with stable ids, a
 *        player's change outlives its chunk, zones keep their ground clear, and unknown rules fail loudly.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setWorldUnitsPerMeter, REFERENCE_UNITS_PER_METER } from '../src/ecs/worldUnits';
import { App } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { setEditorMode, setPlayMode } from '../src/ecs/env';
import { Parent, SceneOwner, Transform } from '../src/ecs/component';
import { createMockModule } from './mocks/wasm';
import { WorldStreamingSource } from '../src/residency/components';
import {
    PlacedObject, WorldGen, WorldGenPlugin, WorldGenRes, WorldZone, ZoneShapeKind, type PlacedObjectData,
} from '../src/worldgen/worldgenPlugin';
import { registerWorldRules, type WorldRules } from '../src/worldgen/rules';
import type { Entity } from '../src/types';
import { Terrain, TerrainExtent, TerrainPlugin, TerrainsRes } from '../src/terrain/terrainPlugin';
import { recordSceneOrigins, sceneOriginsEnabled } from '../src/scene/sceneOrigins';

// These worlds are written in metres: a project of one unit a metre, so the Terrain's own defaults are metres beside them.
beforeAll(() => setWorldUnitsPerMeter(1));
afterAll(() => setWorldUnitsPerMeter(REFERENCE_UNITS_PER_METER));

const rules: WorldRules = {
    id: 'test:ores', versions: [1],
    biomes: [{ id: 'plain', conditions: [], recipes: [{ recipe: 'ore', layer: 'ores', density: 0.7 }] }],
    recipes: [{ id: 'ore', version: 1, anchor: { id: 'copper', mesh: 0, footprint: 1, interactive: 'ore' } }],
    layers: [{ id: 'ores', spacing: 10, drawDistance: 60, chunkSize: 32 }],
};
registerWorldRules(rules);

const boot = () => {
    setDefaultContext(new AppContext());
    setEditorMode(false);
    setPlayMode(false);
    const app = App.new();
    const module = createMockModule();
    app.connectCpp(module.getRegistry(), module);
    app.addPlugin(new WorldGenPlugin());
    return app;
};
// The mock engine composes no transforms: an entity without a parent is given its world pose as well.
const placed = (x: number, y: number, z: number) => ({ position: { x, y, z }, worldPosition: { x, y, z } });
const tick = async (app: App, n = 1) => { for (let i = 0; i < n; i++) { app.tick(1 / 60); await new Promise((r) => setTimeout(r, 0)); } };
const objects = (app: App) => app.world.getEntitiesWithComponents([PlacedObject]).map((e) => (app.world.get(e, PlacedObject) as PlacedObjectData).id);

const world = (app: App, data: Record<string, unknown> = {}): { gen: Entity; source: Entity } => {
    const gen = app.world.spawn();
    app.world.insert(gen, Transform, placed(0, 0, 0));
    app.world.insert(gen, WorldGen, { ...WorldGen._default, rules: 'test:ores', world: 'planet', seed: 3, ...data });
    const source = app.world.spawn();
    app.world.insert(source, Transform, placed(0, 0, 0));
    app.world.insert(source, WorldStreamingSource, { ...WorldStreamingSource._default });
    return { gen, source };
};

describe('a generated world with no renderer', () => {
    it('stands its interactive placements as entities with the plan\'s ids, round the source and no further', async () => {
        const app = boot();
        const { gen } = world(app);
        await tick(app, 30);
        const gens = app.getResource(WorldGenRes);
        expect(gens.status(gen)!.state).toBe('ready');
        const ids = objects(app);
        expect(ids.length).toBeGreaterThan(5);
        expect(new Set(ids).size).toBe(ids.length);
        const plan = gens.plan(gen)!;
        const near = plan.placementsIn(-30, -30, 30, 30).map((p) => p.id);
        for (const id of near) expect(ids).toContain(id);
        for (const id of ids) expect(gens.objectOf(id)).not.toBeNull();
    });

    it('keeps a felled placement felled when its chunk is let go and made again, and forgets nothing else', async () => {
        const app = boot();
        const { source } = world(app);
        await tick(app, 30);
        const gens = app.getResource(WorldGenRes);
        const before = objects(app);
        const felled = before[0]!;
        gens.diffs('planet').remove(felled);
        await tick(app, 5);
        expect(objects(app)).not.toContain(felled);
        expect(objects(app).length).toBe(before.length - 1);
        // Walk away until it is let go, and come back.
        app.world.insert(source, Transform, placed(5000, 0, 0));
        await tick(app, 30);
        expect(objects(app)).not.toContain(before[1]);
        app.world.insert(source, Transform, placed(0, 0, 0));
        await tick(app, 30);
        expect(objects(app).sort()).toEqual(before.filter((id) => id !== felled).sort());
        // And from a save read back into a fresh world.
        const saved = JSON.parse(JSON.stringify(gens.diffs('planet').toJSON()));
        const again = boot();
        world(again);
        again.getResource(WorldGenRes).diffs('planet').load(saved);
        await tick(again, 30);
        expect(objects(again).sort()).toEqual(objects(app).sort());
    });

    it('keeps a zone clear of what it excludes, and only the chunks it reaches change', async () => {
        const app = boot();
        world(app);
        await tick(app, 30);
        const plan = app.getResource(WorldGenRes).plan()!;
        const before = objects(app);
        const home = app.world.spawn();
        app.world.insert(home, Transform, placed(0, 0, 0));
        app.world.insert(home, WorldZone, { ...WorldZone._default, kind: 'home', shape: ZoneShapeKind.Circle, radius: 12, falloff: 0, excludes: '*' });
        await tick(app, 10);
        const after = objects(app);
        expect(after.length).toBeLessThan(before.length);
        for (const id of after) {
            const p = plan.placementsIn(-100, -100, 100, 100).find((q) => q.id === id)!;
            expect(Math.hypot(p.x, p.z)).toBeGreaterThan(12);
        }
        // What stood well away from the home stands there still, under the same id.
        const far = (ids: string[]) => ids.filter((id) => { const p = plan.placementsIn(-100, -100, 100, 100).find((q) => q.id === id); return p && Math.hypot(p.x, p.z) > 50; });
        expect(far(after).sort()).toEqual(far(before).sort());
    });

    it('fails, and places nothing, for rules it does not know or a version they do not have', async () => {
        const app = boot();
        const { gen } = world(app, { rules: 'test:nowhere' });
        const old = world(app, { version: 7 }).gen;
        await tick(app, 10);
        const gens = app.getResource(WorldGenRes);
        expect(gens.status(gen)).toMatchObject({ state: 'failed' });
        expect(gens.status(old)!.reason).toMatch(/version 7/);
        expect(objects(app)).toHaveLength(0);
    });
});

describe('a zone that levels its ground', () => {
    it('lays the terrain flat under it at the height the ground had at its centre, and gives it back when it goes', async () => {
        const app = boot();
        app.addPlugin(new TerrainPlugin());
        const ground = app.world.spawn();
        app.world.insert(ground, Transform, placed(0, 0, 0));
        app.world.insert(ground, Terrain, { ...Terrain._default, extent: TerrainExtent.Infinite, height: 80, sizeX: 600 });
        world(app);
        const plot = app.world.spawn();
        app.world.insert(plot, Transform, placed(30, 0, -20));
        app.world.insert(plot, WorldZone, { ...WorldZone._default, kind: 'building', shape: ZoneShapeKind.Box, sizeX: 30, sizeZ: 20, falloff: 10, flatten: true });
        await tick(app, 20);
        const terrains = app.getResource(TerrainsRes);
        const level = terrains.heightBeneathAt(30, -20)!;
        for (const [x, z] of [[30, -20], [20, -15], [44, -27]] as const) expect(terrains.heightAt(x, z)).toBeCloseTo(level, 6);
        app.world.despawn(plot);
        await tick(app, 5);
        // On a lattice node the surface is the ground's own sample.
        expect(terrains.heightAt(20, -16)).toBeCloseTo(terrains.heightBeneathAt(20, -16)!, 9);
    });
});

describe('authored zone lifetime', () => {
    const terrain = (app: App) => {
        app.addPlugin(new TerrainPlugin());
        const e = app.world.spawn();
        app.world.insert(e, Transform, placed(0, 0, 0));
        app.world.insert(e, Terrain, { ...Terrain._default, extent: TerrainExtent.Infinite, height: 80, sizeX: 600 });
        return app.getResource(TerrainsRes);
    };
    const plot = (app: App, scene = 'forest', id = 7) => {
        const e = app.world.spawn();
        app.world.insert(e, Transform, placed(30, 0, -20));
        app.world.insert(e, WorldZone, { radius: 12, falloff: 30, flatten: true });
        app.world.insert(e, SceneOwner, { scene, persistent: false });
        recordSceneOrigins(app, new Map([[id, e]]));
        return e;
    };
    const children = (app: App, gen: Entity) => app.world.getEntitiesWithComponents([PlacedObject])
        .filter(e => app.world.tryGet(e, Parent)?.entity === gen)
        .map(e => app.world.get(e, PlacedObject).id).sort();

    it('repeats the same falloff placements after reload and releases every authored zone and modifier', async () => {
        const app = boot();
        const terrains = terrain(app);
        const gens = app.getResource(WorldGenRes);
        expect(sceneOriginsEnabled(app)).toBe(true);
        let expected: unknown;
        for (let i = 0; i < 4; i++) {
            const { gen, source } = world(app);
            const zone = plot(app);
            await tick(app, 20);
            const placements = gens.plan(gen)!.placementsIn(-80, -80, 80, 80);
            expect(placements.length).toBeGreaterThan(10);
            if (i === 0) expected = placements;
            else expect(placements).toEqual(expected);
            expect([...gens.zones('planet').all()]).toHaveLength(1);
            expect(terrains.modifiers_.size).toBe(1);
            app.world.despawn(zone);
            app.world.despawn(gen);
            app.world.despawn(source);
            await tick(app, 2);
            expect([...gens.zones('planet').all()]).toHaveLength(0);
            expect(terrains.modifiers_.size).toBe(0);
            expect(terrains.heightAt(20, -16)).toBeCloseTo(terrains.heightBeneathAt(20, -16)!, 9);
        }
    });

    it('namespaces authored ids across additive scenes', async () => {
        const app = boot();
        world(app);
        plot(app, 'village', 7);
        plot(app, 'forest', 7);
        await tick(app);
        expect([...app.getResource(WorldGenRes).zones('planet').all()]).toHaveLength(2);
    });

    it('moves the authored projection when the world name changes, preserving game zones and saved changes', async () => {
        const app = boot();
        const terrains = terrain(app);
        const { gen } = world(app);
        plot(app);
        const gens = app.getResource(WorldGenRes);
        const savedZone = { id: 'built-home', kind: 'home', shape: { type: 'circle' as const, x: 200, z: 200, radius: 10 }, falloff: 5, priority: 0, excludes: ['*'], flatten: 10 };
        gens.zones('planet').set(savedZone);
        gens.diffs('planet').remove('saved-placement');
        await tick(app, 5);
        expect(terrains.modifiers_.size).toBe(2);
        app.world.insert(gen, WorldGen, { ...app.world.get(gen, WorldGen), world: 'new-world' });
        await tick(app, 5);
        expect([...gens.zones('planet').all()]).toEqual([savedZone]);
        expect(gens.diffs('planet').isRemoved('saved-placement')).toBe(true);
        expect([...gens.zones('new-world').all()]).toHaveLength(1);
        expect(terrains.modifiers_.size).toBe(1);
        app.world.remove(gen, WorldGen);
        await tick(app, 2);
        expect([...gens.zones('new-world').all()]).toHaveLength(0);
        expect(terrains.modifiers_.size).toBe(0);
        gens.zones('planet').set({ ...savedZone, flatten: 20 });
        expect(terrains.modifiers_.size).toBe(0);
        world(app);
        await tick(app, 5);
        expect(terrains.modifiers_.size).toBe(2);
    });

    it('updates all live generators without replacing game listeners, and keeps terrain effects until the last one leaves', async () => {
        const app = boot();
        const terrains = terrain(app);
        const a = world(app).gen, b = world(app).gen;
        const gens = app.getResource(WorldGenRes);
        const zoneChanged = vi.fn(), diffChanged = vi.fn();
        gens.zones('planet').onChange = zoneChanged;
        gens.diffs('planet').onChange = diffChanged;
        await tick(app, 30);
        const before = children(app, a);
        expect(before.length).toBeGreaterThan(5);
        expect(children(app, b)).toEqual(before);
        const zone = plot(app);
        await tick(app, 20);
        const after = children(app, a);
        expect(after.length).toBeLessThan(before.length);
        expect(children(app, b)).toEqual(after);
        expect(zoneChanged).toHaveBeenCalled();
        gens.diffs('planet').remove(after[0]!);
        await tick(app, 10);
        expect(children(app, a)).toEqual(after.slice(1));
        expect(children(app, b)).toEqual(after.slice(1));
        expect(diffChanged).toHaveBeenCalledWith(after[0]);
        app.world.despawn(b);
        await tick(app, 2);
        expect(terrains.modifiers_.size).toBe(1);
        expect(terrains.paint_).not.toBeNull();
        expect([...gens.zones('planet').all()]).toHaveLength(1);
        app.world.despawn(zone);
        await tick(app, 20);
        expect(children(app, a)).toEqual(before.filter(id => id !== after[0]));
        app.world.despawn(a);
        await tick(app, 2);
        expect(terrains.modifiers_.size).toBe(0);
        expect(terrains.paint_).toBeNull();
    });

    it('detaches retired plans on seed rebuild and plugin cleanup', async () => {
        const app = boot();
        const terrains = terrain(app);
        const { gen } = world(app);
        plot(app);
        await tick(app, 5);
        const gens = app.getResource(WorldGenRes);
        const retired = vi.spyOn(gens.plan(gen)!, 'invalidate');
        app.world.insert(gen, WorldGen, { ...app.world.get(gen, WorldGen), seed: 4 });
        await tick(app, 5);
        retired.mockClear();
        gens.zones('planet').set({ id: 'new', kind: 'home', shape: { type: 'circle', x: 0, z: 0, radius: 10 }, falloff: 2, priority: 0, excludes: ['*'], flatten: 20 });
        expect(retired).not.toHaveBeenCalled();
        expect(terrains.modifiers_.size).toBe(2);
        // cleanup owns all generated effects even if the authored entities still exist.
        new WorldGenPlugin().cleanup(app);
        expect([...gens.zones('planet').all()].map(z => z.id)).toEqual(['new']);
        expect(terrains.modifiers_.size).toBe(0);
        expect(terrains.paint_).toBeNull();
        gens.zones('planet').delete('new');
        expect(retired).not.toHaveBeenCalled();
    });
});
