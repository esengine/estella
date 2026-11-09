// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { Transform, TilemapLayer, Parent } from '../src/ecs/component';
import { TilemapPlugin, TilemapRuntimeState } from '../src/tilemap/tilemapPlugin';
import { Tilemaps } from '../src/tilemap/tilemapAPI';
import { createDestructibleTilemap, peeringRetile, type DestructibleTilemapOptions } from '../src/tilemap/destructibleTilemap';
import { CHUNK_SIZE } from '../src/tilemap/chunkCodec';
import { TILE_FLIP_H } from '../src/tilemap/tileBits';
import { tileCellCenter } from '../src/tilemap/tileGeometry';
import { createTileset } from '../src/tilemap/tilesetAsset';
import { resolveTilesetModel } from '../src/tilemap/tilesetResolve';
import { Physics2DPlugin, Physics2DEvents } from '../src/physics/Physics2DPlugin';
import { Physics2DRuntime } from '../src/physics/Physics2DRuntime';
import { RigidBody2D, BoxCollider2D, BodyType } from '../src/physics/PhysicsComponents';
import { NavPlugin } from '../src/ai/nav/NavPlugin';
import { Nav } from '../src/ai/nav/Navigation';
import { NavAgent } from '../src/ai/nav/NavAgent';
import { navGridFromTilemapLayer } from '../src/tilemap/navGridFromTilemap';
import type { ESEngineModule } from '../src/wasm';
import type { PhysicsWasmModule } from '../src/physics/PhysicsModuleLoader';
import { HAS_WASM, hasSideModule, loadSideModule, loadWasmModule } from './helpers/loadWasm';

let core: ESEngineModule;
const apps: App[] = [];
afterEach(() => { for (const app of apps.splice(0)) app.quit(); vi.restoreAllMocks(); });

function bare() {
    core.setActiveContext(null);
    const app = App.new(); apps.push(app); app.connectCpp(new core.Registry(), core, { ownedRegistry: true });
    app.addPlugin(new TilemapPlugin());
    const world = app.world, layer = world.spawn(), tiles = app.getResource(Tilemaps);
    world.insert(layer, Transform); world.insert(layer, TilemapLayer, { cellSize: { x: 16, y: 16 } });
    // Layers live in the core by entity id, and an id comes round again in the next world.
    tiles.destroyLayer(layer);
    tiles.initInfiniteLayer(layer, 16, 16);
    const open = (options: DestructibleTilemapOptions = {}) => createDestructibleTilemap(app, layer, options);
    return { app, world, layer, tiles, open };
}

async function withPhysics(gravity = -9.81) {
    const scene = bare();
    const module = await loadSideModule<PhysicsWasmModule>('physics');
    scene.app.addPlugin(new Physics2DPlugin('', { gravity: { x: 0, y: gravity }, fixedTimestep: 1 / 60 }, async () => module));
    await scene.app.getResource(Physics2DRuntime).initPromise;
    scene.app.getResource(TilemapRuntimeState).setLayerTilesets(scene.layer, ['builtin:collision']);
    const bodies = () => scene.world.getEntitiesWithComponents([RigidBody2D, Parent])
        .filter(id => scene.world.get(id, Parent).entity === scene.layer);
    return { ...scene, module, bodies };
}

describe.skipIf(!HAS_WASM)('destructible tilemap', () => {
    beforeAll(async () => { core = await loadWasmModule(); });

    describe('blows', () => {
        it('wears a tile down and destroys it at its hardness', () => {
            const { tiles, layer, open } = bare();
            const map = open({ hardness: id => (id === 2 ? 10 : 1) });
            tiles.setTile(layer, 1, 1, 2);
            expect(map.dig(1, 1, 4)).toMatchObject({ damage: 4, hardness: 10, destroyed: false });
            expect(map.damageAt(1, 1)).toBe(4);
            expect(tiles.getTile(layer, 1, 1)).toBe(2);
            expect(map.dig(1, 1, 6)).toMatchObject({ tile: 2, damage: 0, destroyed: true });
            expect(tiles.getTile(layer, 1, 1)).toBe(0);
            expect(map.damageAt(1, 1)).toBe(0);
            expect(map.dig(1, 1, 6)).toBeNull();
        });

        it('refuses what cannot be destroyed, and a blow with no force', () => {
            const { tiles, layer, open } = bare();
            const map = open({ hardness: () => Infinity });
            tiles.setTile(layer, 0, 0, 3);
            expect(map.dig(0, 0)).toBeNull();
            expect(tiles.getTile(layer, 0, 0)).toBe(3);
            const soft = open({ hardness: 1 });
            expect(soft.dig(0, 0, 0)).toBeNull();
            expect(soft.dig(0, 0, Number.NaN)).toBeNull();
            expect(soft.damageAt(0, 0)).toBe(0);
        });

        it('reads hardness from the tile property, and from an .estileset', async () => {
            const { app, tiles, layer, open } = bare();
            tiles.setTile(layer, 0, 0, 5);
            tiles.setTileProperty(layer, 5, 'hardness', '7');
            const map = open();
            expect(map.dig(0, 0, 1)).toMatchObject({ hardness: 7 });
            tiles.setTile(layer, 1, 0, 6);
            expect(map.dig(1, 0, 1)).toMatchObject({ hardness: 1, destroyed: true });

            const asset = createTileset('', 16, 16, 4);
            asset.tiles[3] = { properties: { hardness: '9' } };
            const model = resolveTilesetModel([{ asset, textureHandle: 1, textureHeight: 64 }]);
            expect(model.tileProperties?.get(3)).toEqual({ hardness: '9' });
            const runtime = app.getResource(TilemapRuntimeState) as unknown as {
                applyTileProperties_(tiles: unknown, entity: number, next: Map<number, Record<string, string>>): void;
            };
            runtime.applyTileProperties_(tiles, layer, model.tileProperties!);
            tiles.setTile(layer, 2, 0, 3);
            expect(tiles.getTileProperty(layer, 2, 0, 'hardness')).toBe('9');
            runtime.applyTileProperties_(tiles, layer, new Map());
            expect(tiles.getTileProperty(layer, 2, 0, 'hardness')).toBe('');
        });

        it('forgets damage when another tile is put in the cell', () => {
            const { tiles, layer, open } = bare();
            tiles.setTile(layer, 0, 0, 1);
            const map = open({ hardness: 10 });
            map.dig(0, 0, 4);
            map.set(0, 0, 1 | TILE_FLIP_H);
            expect(map.damageAt(0, 0)).toBe(4);
            map.set(0, 0, 2);
            expect(map.damageAt(0, 0)).toBe(0);
        });

        it('leaves what replaceWith says, and never the same tile', () => {
            const { tiles, layer, open } = bare();
            const map = open({ replaceWith: id => (id === 1 ? 2 : id) });
            tiles.setTile(layer, 0, 0, 1); tiles.setTile(layer, 1, 0, 3);
            map.dig(0, 0); map.dig(1, 0);
            expect(tiles.getTile(layer, 0, 0)).toBe(2);
            expect(tiles.getTile(layer, 1, 0)).toBe(0);
        });

        it('takes a world position through the layer origin and rotation', () => {
            const { world, tiles, layer, open } = bare();
            world.update(layer, Transform, t => { t.position.x = 1000; t.position.y = 500; });
            world.update(layer, TilemapLayer, l => { l.originOffset = { x: 32, y: 0 }; });
            tiles.setTile(layer, 2, 3, 1);
            const map = open();
            expect(map.worldToTile(1000 + 32 + 2.5 * 16, 500 - 3.5 * 16)).toEqual({ x: 2, y: 3 });
            expect(map.digAtWorld(1000 + 32 + 2.5 * 16, 500 - 3.5 * 16)?.destroyed).toBe(true);
            world.update(layer, Transform, t => {
                t.position.x = 0; t.position.y = 0;
                t.rotation = { w: Math.SQRT1_2, x: 0, y: 0, z: Math.SQRT1_2 };
            });
            world.update(layer, TilemapLayer, l => { l.originOffset = { x: 0, y: 0 }; });
            // A quarter turn counter-clockwise carries layer (x, y) to world (-y, x).
            expect(map.worldToTile(3.5 * 16, 2.5 * 16)).toEqual({ x: 2, y: 3 });
        });
    });

    describe('explosions', () => {
        function field(size = 21) {
            const scene = bare();
            scene.tiles.fillRect(scene.layer, 0, 0, size, size, 1);
            return scene;
        }
        const centre = { x: 10.5 * 16, y: -10.5 * 16 };

        it('takes a circle and falls off toward the rim', () => {
            const { tiles, layer, open } = field();
            const map = open({ hardness: 100 });
            const hits = map.explode(centre.x, centre.y, 5 * 16, 80);
            const at = (x: number, y: number) => hits.find(h => h.x === x && h.y === y);
            expect(at(10, 10)?.damage).toBeCloseTo(80);
            expect(at(13, 10)?.damage).toBeCloseTo(32);
            expect(at(15, 10)?.damage ?? 0).toBeCloseTo(0);
            expect(at(14, 14)).toBeUndefined();
            expect(hits.every(h => !h.destroyed)).toBe(true);
            expect(tiles.getTile(layer, 10, 10)).toBe(1);
            const flat = map.explode(centre.x, centre.y, 5 * 16, 20, { falloff: 0 });
            expect(flat.find(h => h.x === 13 && h.y === 10)?.damage).toBeCloseTo(52);
        });

        it('destroys what its force beats and reports each cell once, together', () => {
            const { tiles, layer, open } = field();
            const map = open();
            const heard: number[] = [];
            map.subscribe(edits => heard.push(edits.length));
            const hits = map.explode(centre.x, centre.y, 3 * 16, 1000);
            expect(hits.length).toBeGreaterThan(20);
            expect(hits.every(h => h.destroyed)).toBe(true);
            expect(new Set(hits.map(h => `${h.x},${h.y}`)).size).toBe(hits.length);
            expect(heard).toEqual([hits.length]);
            for (const h of hits) expect(tiles.getTile(layer, h.x, h.y)).toBe(0);
            expect(tiles.getTile(layer, 10, 14)).toBe(1);
        });

        it('stops at a wall that cannot be destroyed when shielded', () => {
            const { tiles, layer, open } = field();
            for (let y = 0; y < 21; y++) tiles.setTile(layer, 13, y, 9);
            const hardness = (id: number) => (id === 9 ? Infinity : 1);
            const open_ = open({ hardness });
            open_.explode(centre.x, centre.y, 6 * 16, 1000, { falloff: 0 });
            expect(tiles.getTile(layer, 12, 10)).toBe(0);
            expect(tiles.getTile(layer, 13, 10)).toBe(9);
            expect(tiles.getTile(layer, 14, 10)).toBe(0);

            const { tiles: tiles2, layer: layer2, open: open2 } = field();
            for (let y = 0; y < 21; y++) tiles2.setTile(layer2, 13, y, 9);
            open2({ hardness }).explode(centre.x, centre.y, 6 * 16, 1000, { falloff: 0, shielded: true });
            expect(tiles2.getTile(layer2, 12, 10)).toBe(0);
            expect(tiles2.getTile(layer2, 14, 10)).toBe(1);
        });

        it.each([[1, 0, 0], [2, 0, 0], [3, 6, 1]])('measures from cell centres on a non-square grid (orientation %s)', (orientation, hexSideLength, staggerAxis) => {
            const { world, tiles, layer, open } = field();
            tiles.fillRect(layer, -30, -30, 90, 90, 1);
            world.update(layer, TilemapLayer, l => { l.orientation = orientation!; l.hexSideLength = hexSideLength!; l.staggerAxis = staggerAxis!; });
            tiles.setGridType(layer, orientation!); tiles.setHexParams(layer, hexSideLength!, staggerAxis === 1, false);
            const map = open();
            const grid = { orientation: orientation!, tileWidth: 16, tileHeight: 16, hexSideLength: hexSideLength!, staggerAxisX: staggerAxis === 1 };
            const centreTile = tileCellCenter(grid, 10, 10);
            // The geometry the blast measures with and the grid the engine picks with are one grid.
            expect(map.worldToTile(centreTile.x, centreTile.y)).toEqual({ x: 10, y: 10 });
            const hits = map.explode(centreTile.x, centreTile.y, 40, 1000);
            expect(hits.some(h => h.x === 10 && h.y === 10)).toBe(true);
            for (const h of hits) {
                const c = tileCellCenter(grid, h.x, h.y);
                expect(Math.hypot(c.x - centreTile.x, c.y - centreTile.y)).toBeLessThanOrEqual(40);
            }
            const reached = new Set(hits.map(h => `${h.x},${h.y}`));
            for (let y = -5; y < 25; y++) for (let x = -5; x < 25; x++) {
                const c = tileCellCenter(grid, x, y);
                if (Math.hypot(c.x - centreTile.x, c.y - centreTile.y) < 39.9) expect(reached.has(`${x},${y}`)).toBe(true);
            }
        });
    });

    describe('autotile', () => {
        const edgeSet = () => {
            const asset = createTileset('', 16, 16, 16);
            asset.terrains = [{ name: 'dirt', mode: 'edge' }];
            for (let mask = 0; mask < 16; mask++) asset.tiles[mask + 1] = { terrain: { set: 0, mask } };
            return asset;
        };

        it('re-resolves the neighbours of a dug cell', () => {
            const { tiles, layer, open } = bare();
            const map = open({ retile: peeringRetile(edgeSet()) });
            map.fillRect(0, 0, 3, 3, 1);
            const FULL = 16;
            expect(tiles.getTile(layer, 1, 1)).toBe(FULL);
            const edits: string[] = [];
            map.subscribe(list => { for (const e of list) edits.push(`${e.x},${e.y}:${e.cause}`); });
            map.dig(1, 1);
            expect(tiles.getTile(layer, 1, 1)).toBe(0);
            // The tile above the hole no longer has a tile south of it: mask 4 cleared.
            expect(tiles.getTile(layer, 1, 0)).toBe(2 + 8 + 1);
            expect(edits).toContain('1,1:dig');
            expect(edits).toContain('1,0:retile');
        });

        it('offsets by firstId, and restores exactly from a save', () => {
            const { tiles, layer, open } = bare();
            const map = open({ retile: peeringRetile(edgeSet(), 101) });
            map.fillRect(0, 0, 3, 1, 101);
            expect(tiles.getTile(layer, 1, 0)).toBe(2 + 8 + 101);
            const save = JSON.parse(JSON.stringify(map.toJSON()));
            const { tiles: fresh, layer: layer2, open: open2 } = bare();
            const retile = vi.fn(() => undefined);
            expect(open2({ retile }).load(save)).toBe(true);
            expect(fresh.getTile(layer2, 1, 0)).toBe(2 + 8 + 101);
            expect(retile).not.toHaveBeenCalled();
        });
    });

    describe('saves', () => {
        it('stores only what changed, and comes back through JSON', () => {
            const { tiles, layer, open } = bare();
            tiles.fillRect(layer, 0, 0, 40, 40, 1);
            const map = open({ hardness: 10 });
            map.dig(3, 3); map.dig(20, 20, 4); map.set(-5, -5, 2 | TILE_FLIP_H);
            expect(map.changedCells).toBe(2);
            const data = JSON.parse(JSON.stringify(map.toJSON()));
            expect(JSON.stringify(data).length).toBeLessThan(200);

            const next = bare();
            next.tiles.fillRect(next.layer, 0, 0, 40, 40, 1);
            const again = next.open({ hardness: 10 });
            expect(again.load(data)).toBe(true);
            expect(next.tiles.getTile(next.layer, 3, 3)).toBe(0);
            expect(next.tiles.getTile(next.layer, -5, -5)).toBe(2 | TILE_FLIP_H);
            expect(next.tiles.getTile(next.layer, 20, 20)).toBe(1);
            expect(again.damageAt(20, 20)).toBe(4);
            expect(again.dig(20, 20, 6)?.destroyed).toBe(true);
            expect(JSON.stringify(again.toJSON()).length).toBeGreaterThan(0);
        });

        it('puts back what this session changed when a save loads, and forgets a cell returned to what it was', () => {
            const { tiles, layer, open } = bare();
            tiles.fillRect(layer, 0, 0, 4, 1, 1);
            const map = open();
            const empty = map.toJSON();
            map.dig(0, 0); map.dig(1, 0);
            expect(map.changedCells).toBe(2);
            const dug = map.toJSON();
            map.set(0, 0, 1);
            expect(map.changedCells).toBe(1);
            expect(map.load(empty)).toBe(true);
            expect(map.changedCells).toBe(0);
            expect(tiles.getTile(layer, 1, 0)).toBe(1);
            for (let i = 0; i < 2; i++) {
                expect(map.load(dug)).toBe(true);
                expect(map.changedCells).toBe(2);
                expect(tiles.getTile(layer, 0, 0)).toBe(0);
            }
            expect(map.toJSON()).toEqual(dug);
        });

        it.each([
            ['another version', (d: any) => { d.version = 2; }],
            ['no chunks', (d: any) => { delete d.chunks; }],
            ['a cell off the chunk', (d: any) => { d.chunks[0].cells[0] = 9999; }],
            ['a cell that is no tile', (d: any) => { d.chunks[0].cells[1] = 70000; }],
            ['an odd pair list', (d: any) => { d.chunks[0].cells.push(1); }],
            ['damage that is no number', (d: any) => { d.chunks[0].damage = [0, 'x']; }],
            ['a tile the id mask cannot hold', (d: any) => { d.encoding[1] = 0xffff; d.chunks[0].cells[1] = 0x7fff; }],
        ])('refuses %s whole and leaves the layer alone', (_name, spoil) => {
            const { tiles, layer, open } = bare();
            const map = open();
            map.set(0, 0, 1); map.set(1, 0, 1);
            const data = JSON.parse(JSON.stringify(map.toJSON()));
            spoil(data);
            map.set(2, 0, 3);
            expect(map.load(data)).toBe(false);
            expect(tiles.getTile(layer, 2, 0)).toBe(3);
            expect(map.changedCells).toBe(3);
        });

        it('reads a save written under another encoding by what its cells mean', () => {
            const { tiles, layer, open } = bare();
            const map = open();
            const flip = 0x8000, side = 8;
            expect(map.load({ version: 1, encoding: [side, 0x0fff, flip, 0x4000, 0x2000],
                chunks: [{ x: 3, y: -1, cells: [side + 2, 5 | flip] }] })).toBe(true);
            expect(tiles.getTile(layer, 3 * side + 2, -side + 1)).toBe(5 | TILE_FLIP_H);
        });

        it('keeps a chunk as it was left through release and regeneration', () => {
            const { tiles, layer, open } = bare();
            const map = open({ streamed: true, hardness: 10 });
            const generated = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE).fill(1);
            expect(map.dig(0, 0)).toBeNull();
            expect(tiles.getTile(layer, 0, 0)).toBe(0);
            map.publishChunk(0, 0, generated);
            map.dig(2, 2); map.dig(3, 3, 4);
            map.releaseChunk(0, 0);
            expect(tiles.getTile(layer, 2, 2)).toBe(0);
            expect(map.dig(5, 5)).toBeNull();
            map.publishChunk(0, 0, generated);
            expect(generated[2 * CHUNK_SIZE + 2]).toBe(1);
            expect(tiles.getTile(layer, 2, 2)).toBe(0);
            expect(tiles.getTile(layer, 1, 1)).toBe(1);
            expect(map.damageAt(3, 3)).toBe(4);
        });

        it('holds a loaded save for a chunk not yet streamed in', () => {
            const first = bare();
            const a = first.open({ streamed: true });
            const generated = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE).fill(1);
            a.publishChunk(0, 0, generated); a.dig(1, 1);
            const save = JSON.parse(JSON.stringify(a.toJSON()));

            const second = bare();
            const b = second.open({ streamed: true });
            expect(b.load(save)).toBe(true);
            expect(second.tiles.getTile(second.layer, 2, 2)).toBe(0);
            expect(b.toJSON()).toEqual(save);
            b.publishChunk(0, 0, generated);
            expect(second.tiles.getTile(second.layer, 1, 1)).toBe(0);
            expect(second.tiles.getTile(second.layer, 2, 2)).toBe(1);
            expect(b.toJSON()).toEqual(save);
        });
    });

    describe.skipIf(!hasSideModule('physics'))('collision', () => {
        it('keeps every collider a dig in the same chunk does not change', async () => {
            const { app, world, tiles, layer, bodies, module } = await withPhysics();
            for (let x = 0; x < 16; x++) tiles.setTile(layer, x, 3, 1);
            tiles.setTile(layer, 14, 8, 1);
            await app.tick(1 / 60);
            const floor = bodies().find(id => world.get(id, Transform).position.y > -100)!;
            const actor = world.spawn();
            world.insert(actor, Transform, { position: { x: 40, y: -20, z: 0 } });
            world.insert(actor, RigidBody2D, { bodyType: BodyType.Dynamic });
            world.insert(actor, BoxCollider2D, { halfExtents: { x: 0.03, y: 0.03 } });
            await app.stepFrames(300, 1 / 60);
            expect(module._physics_isAwake(actor)).toBe(0);
            tiles.setTile(layer, 14, 8, 0);
            for (let i = 0; i < 3; i++) {
                await app.tick(1 / 60);
                const events = app.getResource(Physics2DEvents);
                expect([...events.collisionEnters, ...events.collisionExits].filter(e => e.entityA === actor || e.entityB === actor)).toEqual([]);
            }
            expect(world.valid(floor)).toBe(true);
            expect(module._physics_isAwake(actor)).toBe(0);
        });

        it('a dug floor drops what slept on it', async () => {
            const { app, world, tiles, layer, open, module } = await withPhysics();
            tiles.fillRect(layer, 0, 3, 16, 3, 1);
            const map = open();
            await app.tick(1 / 60);
            const actor = world.spawn();
            world.insert(actor, Transform, { position: { x: 40, y: -20, z: 0 } });
            world.insert(actor, RigidBody2D, { bodyType: BodyType.Dynamic });
            world.insert(actor, BoxCollider2D, { halfExtents: { x: 0.03, y: 0.03 } });
            await app.stepFrames(300, 1 / 60);
            expect(module._physics_isAwake(actor)).toBe(0);
            const rest = world.get(actor, Transform).position.y;
            map.explode(40, rest, 64, 1000, { falloff: 0 });
            await app.stepFrames(30, 1 / 60);
            expect(world.get(actor, Transform).position.y).toBeLessThan(rest - 20);
        });

        it('leaves buried ground with no bodies, and the surface alone when it is dug', async () => {
            const { app, world, tiles, layer, open, bodies, module } = await withPhysics(0);
            tiles.fillRect(layer, -16, -16, 48, 48, 1);
            const map = open();
            await app.tick(1 / 60);
            // A 48x48 block over 9 chunks: the middle chunk holds no collider at all.
            const inside = (id: number) => {
                const p = world.get(id, Transform).position;
                return p.x > 0 && p.x < 256 && p.y < 0 && p.y > -256;
            };
            expect(bodies().filter(inside)).toEqual([]);
            const surface = new Set(bodies());
            expect(surface.size).toBeLessThan(20);

            map.dig(8, 8);
            await app.tick(1 / 60);
            const after = bodies();
            for (const id of surface) expect(after).toContain(id);
            expect(after.length - surface.size).toBe(4);
            expect(module._physics_getBodyCount()).toBe(after.length);
        });

        it('rebuilds across a chunk edge when a neighbour is opened', async () => {
            const { app, world, tiles, layer, open, bodies } = await withPhysics(0);
            tiles.fillRect(layer, 0, 0, 48, 16, 1);
            const map = open();
            await app.tick(1 / 60);
            const count = bodies().length;
            // Column 16 is chunk 1's first; chunk 0's column 15 was buried behind it.
            for (let y = 0; y < 16; y++) map.dig(16, y);
            await app.tick(1 / 60);
            const xs = bodies().map(id => world.get(id, Transform).position.x);
            expect(xs.some(x => x > 15 * 16 && x < 16 * 16)).toBe(true);
            expect(bodies().length).toBeGreaterThan(count);
            tiles.fillRect(layer, 16, 0, 1, 16, 1);
            await app.tick(1 / 60);
            expect(bodies().length).toBe(count);
        });

        it('lets a body stand on outline ground as it stood on merged ground', async () => {
            const { app, world, tiles, layer, open, bodies } = await withPhysics();
            tiles.fillRect(layer, -32, 3, 64, 40, 1);
            open();
            await app.tick(1 / 60);
            const actor = world.spawn();
            world.insert(actor, Transform, { position: { x: 40, y: -20, z: 0 } });
            world.insert(actor, RigidBody2D, { bodyType: BodyType.Dynamic });
            world.insert(actor, BoxCollider2D, { halfExtents: { x: 0.03, y: 0.03 } });
            await app.stepFrames(200, 1 / 60);
            expect(world.get(actor, Transform).position.y).toBeGreaterThan(-52);
            expect(bodies().length).toBeLessThan(25);
        });

        it('can be left with merged ground', async () => {
            const { app, tiles, layer, open, bodies } = await withPhysics(0);
            tiles.fillRect(layer, 0, 0, 16, 16, 1);
            open({ collisionOutline: false });
            await app.tick(1 / 60);
            expect(bodies()).toHaveLength(1);
        });

        it('turning the outline on rebuilds a running layer', async () => {
            const { app, tiles, layer, bodies } = await withPhysics(0);
            tiles.fillRect(layer, 0, 0, 16, 16, 1);
            await app.tick(1 / 60);
            expect(bodies()).toHaveLength(1);
            app.getResource(TilemapRuntimeState).setCollisionOutline(layer, true);
            await app.tick(1 / 60);
            expect(bodies().length).toBeGreaterThan(1);
        });
    });

    describe('navigation', () => {
        it('flips exactly the changed cell, and places the grid where the layer draws', () => {
            const { world, tiles, layer, open } = bare();
            world.update(layer, Transform, t => { t.position.x = 320; t.position.y = 160; });
            tiles.fillRect(layer, 5, 0, 1, 10, 1);
            const map = open();
            const grid = map.createNavGrid({ width: 10, height: 10 });
            const revision = () => grid.topologyRevision;
            const wall = { x: 320 + 5.5 * 16, y: 160 - 4.5 * 16 };
            const cell = grid.worldToCell(wall);
            expect(cell).toEqual({ x: 5, y: 5 });
            expect(grid.isWalkable(5, 5)).toBe(false);
            const before = revision();
            map.dig(5, 4);
            expect(grid.isWalkable(5, 5)).toBe(true);
            expect(revision()).toBe(before + 1);
            let open_ = 0;
            for (let y = 0; y < 10; y++) if (grid.isWalkable(5, y)) open_++;
            expect(open_).toBe(1);
            map.set(5, 4, 1);
            expect(grid.isWalkable(5, 5)).toBe(false);
        });

        it('agrees with the existing builder on the same tiles', () => {
            const { tiles, layer, open } = bare();
            tiles.setTile(layer, 1, 2, 1); tiles.setTile(layer, 3, 0, 1);
            const map = open();
            const grid = map.createNavGrid({ width: 5, height: 4 });
            const built = navGridFromTilemapLayer(layer, { width: 5, height: 4, cellSize: 16 });
            expect([...grid.walkable]).toEqual([...built.walkable]);
        });

        it('honours a tile rectangle, a predicate, and stops when told', () => {
            const { tiles, layer, open } = bare();
            tiles.setTile(layer, 100, 200, 1); tiles.setTile(layer, 101, 200, 2);
            const map = open();
            const grid = map.createNavGrid({ tileX: 100, tileY: 200, width: 4, height: 1, isBlocked: id => id === 2 });
            expect([...grid.walkable]).toEqual([1, 0, 1, 1]);
            map.set(102, 200, 2);
            map.set(50, 50, 2);
            expect([...grid.walkable]).toEqual([1, 0, 0, 1]);
            const other = map.createNavGrid({ tileX: 100, tileY: 200, width: 4, height: 1, isBlocked: id => id === 2 });
            const stop = map.syncNavGrid(other);
            stop();
            map.set(103, 200, 2);
            expect(grid.isWalkable(3, 0)).toBe(false);
        });

        it('does not block on a sensor tile, and does on a solid one, by the layer\'s collision', async () => {
            const { app, open } = await withPhysics(0);
            await app.tick(1 / 60);
            const map = open();
            const grid = map.createNavGrid({ width: 3, height: 1 });
            const palette = await import('../src/tilemap/collisionPalette');
            const brushes = palette.buildCollisionPaletteModel();
            const solid = brushes.collidableTileIds[0]!;
            const sensor = [...brushes.tileShapes].find(([, s]) => s.sensor)![0];
            map.set(0, 0, solid); map.set(1, 0, sensor);
            expect([...grid.walkable]).toEqual([0, 1, 1]);
        });

        it('restores the grid from a load and a streamed chunk', () => {
            const { open } = bare();
            const map = open({ streamed: true });
            const grid = map.createNavGrid({ width: 2, height: 1 });
            const generated = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE).fill(1);
            expect([...grid.walkable]).toEqual([1, 1]);
            map.publishChunk(0, 0, generated);
            expect([...grid.walkable]).toEqual([0, 0]);
            map.dig(0, 0);
            const save = map.toJSON();
            expect([...grid.walkable]).toEqual([1, 0]);
            map.set(0, 0, 1);
            expect([...grid.walkable]).toEqual([0, 0]);
            map.load(save);
            expect([...grid.walkable]).toEqual([1, 0]);
            map.releaseChunk(0, 0);
            map.publishChunk(0, 0, generated);
            expect([...grid.walkable]).toEqual([1, 0]);
        });

        it('walks an agent through the hole a dig made', async () => {
            const { app, world, tiles, layer, open } = bare();
            app.addPlugin(new NavPlugin());
            tiles.fillRect(layer, 5, 0, 1, 11, 1);
            const map = open();
            const nav = app.getResource(Nav);
            const grid = map.createNavGrid({ width: 11, height: 11 });
            nav.setSurface(grid);
            const agent = world.spawn();
            world.insert(agent, Transform, { position: { x: 2.5 * 16, y: -5.5 * 16, z: 0 } });
            const goal = { x: 8.5 * 16, y: -5.5 * 16 };
            world.insert(agent, NavAgent, { speed: 400, radius: 0, arriveRadius: 2, hasTarget: true, targetX: goal.x, targetY: goal.y, targetZ: 0, repathInterval: 0 });
            await app.stepFrames(60, 1 / 60);
            expect(world.get(agent, NavAgent).arrived).toBeFalsy();
            expect(world.get(agent, Transform).position.x).toBeLessThan(5 * 16);
            map.dig(5, 5);
            await app.stepFrames(60, 1 / 60);
            expect(world.get(agent, NavAgent).arrived).toBe(true);
            expect(world.get(agent, Transform).position.x).toBeGreaterThan(8 * 16);
        });

        it('refuses a grid the layer cannot be', () => {
            const { world, layer, open } = bare();
            world.update(layer, TilemapLayer, l => { l.cellSize = { x: 16, y: 24 }; });
            expect(() => open().createNavGrid({ width: 2, height: 2 })).toThrow(/square/);
        });
    });

    describe('edits', () => {
        it('ignores a finite layer\'s outside, and records nothing for it', () => {
            const { tiles, layer, open } = bare();
            tiles.initLayer(layer, 4, 4, 16, 16);
            const map = open();
            expect(map.set(10, 10, 1)).toBe(false);
            expect(map.changedCells).toBe(0);
            expect(map.set(1, 1, 1)).toBe(true);
            expect(map.changedCells).toBe(1);
        });

        it('hears one change for one operation, and nothing for no change', () => {
            const { open } = bare();
            const map = open();
            const heard = vi.fn();
            const stop = map.subscribe(heard);
            expect(map.fillRect(0, 0, 2, 2, 1)).toHaveLength(4);
            expect(heard).toHaveBeenCalledOnce();
            expect(map.fillRect(0, 0, 2, 2, 1)).toHaveLength(0);
            expect(heard).toHaveBeenCalledOnce();
            stop();
            map.set(9, 9, 1);
            expect(heard).toHaveBeenCalledOnce();
        });
    });
});
