// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a scene AUTHORING a NavVolume gets.
 *
 * The bake itself is proved against triangles handed to it; this is about the
 * seam above: which box is sampled, whose settings it uses, and that a volume is
 * baked once rather than every frame it exists.
 */
import { describe, it, expect, vi } from 'vitest';
import { bakeVolumes } from '../src/ai/nav/NavPlugin';
import { NavVolume, type NavVolumeData } from '../src/ai/nav/NavVolume';
import { Navigation } from '../src/ai/nav/Navigation';
import { NavMesh } from '../src/ai/nav/NavMesh';
import { Transform } from '../src/ecs/component';
import type { Vec3 } from '../src/types';

/** The narrow world view `bakeVolumes` walks, with just enough store to answer. */
class VolumeWorld {
    private store = new Map<string, unknown>();
    private ids: number[] = [];
    spawn(comps: Array<[{ _name: string }, unknown]>): number {
        const e = this.ids.length + 1;
        for (const [def, data] of comps) this.store.set(`${e}:${def._name}`, data);
        this.ids.push(e);
        return e;
    }
    getEntitiesWithComponents(defs: readonly { _name: string }[]): number[] {
        return this.ids.filter(e => defs.every(d => this.store.has(`${e}:${d._name}`)));
    }
    get(e: number, def: { _name: string }): never {
        return this.store.get(`${e}:${def._name}`) as never;
    }
    set(): void { /* the bake writes nothing back */ }
}

/** A floor slab as world triangles, whatever box is asked for. */
function floorGeometry(y = 0) {
    return (min: Vec3, max: Vec3) => {
        const verts: number[] = [];
        for (const [x, z] of [[min.x, min.z], [max.x, min.z], [max.x, max.z], [min.x, max.z]]) {
            verts.push(x!, y, z!);
        }
        return {
            verts: Float32Array.from(verts),
            indices: Uint32Array.from([0, 2, 1, 0, 3, 2]),
            bodyCount: 1,
        };
    };
}

const spawnVolume = (w: VolumeWorld, over: Partial<NavVolumeData> = {}) => w.spawn([
    [NavVolume, NavVolume.create({
        halfExtents: { x: 400, y: 200, z: 400 }, cellSize: 25, agentRadius: 0, ...over,
    })],
    [Transform, { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } }],
]);

describe('bakeVolumes', () => {
    it('bakes an authored volume into the active surface, centred on its Transform', () => {
        const w = new VolumeWorld();
        spawnVolume(w);
        const nav = new Navigation();
        bakeVolumes(w as never, nav, floorGeometry(), new Set());

        const mesh = nav.surface as NavMesh;
        expect(mesh).toBeInstanceOf(NavMesh);
        expect(mesh.polyCount).toBeGreaterThan(0);
        expect(mesh.findPoly({ x: 0, y: 0, z: 0 })).toBeGreaterThanOrEqual(0);
        // Outside the box there is no mesh, however much floor was handed over.
        expect(mesh.findPoly({ x: 900, y: 0, z: 0 })).toBe(-1);
    });

    it('does nothing at all until the world can answer', () => {
        const w = new VolumeWorld();
        spawnVolume(w);
        const nav = new Navigation();
        bakeVolumes(w as never, nav, null, new Set());
        expect(nav.surface).toBeNull();
    });

    it('bakes each volume once, however many frames run', () => {
        const w = new VolumeWorld();
        spawnVolume(w);
        const geometry = vi.fn(floorGeometry());
        const baked = new Set<number>();
        const nav = new Navigation();
        bakeVolumes(w as never, nav, geometry, baked as never);
        bakeVolumes(w as never, nav, geometry, baked as never);
        expect(geometry).toHaveBeenCalledTimes(1);
    });

    it('carries the volume own settings into the bake', () => {
        const w = new VolumeWorld();
        spawnVolume(w, { agentRadius: 90 });
        const nav = new Navigation();
        bakeVolumes(w as never, nav, floorGeometry(), new Set());
        expect((nav.surface as NavMesh).agentRadius).toBe(90);
        // And it means it: a body that wide cannot stand at the wall.
        expect((nav.surface as NavMesh).findPoly({ x: 395, y: 0, z: 0 })).toBe(-1);
    });

    // A scene has one navigable world, and which volume supplies it may not be an
    // accident of iteration order.
    it('bakes the first volume and says the others were not', () => {
        const w = new VolumeWorld();
        spawnVolume(w);
        spawnVolume(w, { halfExtents: { x: 100, y: 100, z: 100 } });
        const geometry = vi.fn(floorGeometry());
        const baked = new Set<number>();
        const nav = new Navigation();
        bakeVolumes(w as never, nav, geometry, baked as never);
        bakeVolumes(w as never, nav, geometry, baked as never);
        expect(geometry).toHaveBeenCalledTimes(1);
        // The one that was baked is the first, not whichever came last.
        expect((nav.surface as NavMesh).findPoly({ x: 300, y: 0, z: 300 })).toBeGreaterThanOrEqual(0);
    });

    it('asks only for the layers the volume names', () => {
        const w = new VolumeWorld();
        spawnVolume(w, { layers: 0b1010 });
        const geometry = vi.fn(floorGeometry());
        bakeVolumes(w as never, new Navigation(), geometry, new Set());
        expect(geometry).toHaveBeenCalledWith(expect.anything(), expect.anything(), 0b1010);
    });
});
