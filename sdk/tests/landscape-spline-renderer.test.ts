// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it, vi } from 'vitest';
import type { App } from '../src/app/app';
import type { Entity } from '../src/types';
import { builtinMeshTemplate } from '../src/asset/builtinMeshes';
import { LandscapeRenderer } from '../src/terrain/landscapeRenderer';
import { connectLandscape, landscapeMesh, landscapePoint } from '../src/terrain/landscapeSpline';
import { Terrain } from '../src/terrain/terrainPlugin';
import type { LandscapeSpline } from '../src/terrain/landscapeSpline';

it('keeps the live road while a replacement loads and releases obsolete and removed geometry', async () => {
    const mesh = builtinMeshTemplate('builtin:cube')!.build(),
        renderer = new LandscapeRenderer();
    const live = new Map<number, unknown>(),
        released: string[] = [];
    let next = 1,
        finish: (() => void) | undefined;
    const assets = {
        acquireTyped: async (_type: string, ref: string) => {
            if (ref === 'slow')
                await new Promise<void>((resolve) => {
                    finish = resolve;
                });
            return { value: { handle: 1 }, release: () => released.push(ref) };
        },
        readMeshData: async () => mesh,
        createMesh: vi.fn(() => ++next),
        releaseBuiltMesh: vi.fn(),
    };
    const app = {
        getResource: () => assets,
        world: {
            spawn: () => ++next,
            insert: (e: number, _component: unknown, data: unknown) => live.set(e, data),
            setParent: vi.fn(),
            get: (e: number) => live.get(e),
            set: (e: number, _component: unknown, data: unknown) => live.set(e, data),
            valid: (e: number) => live.has(e),
            despawn: (e: number) => live.delete(e),
        },
    } as unknown as App;
    const a = landscapePoint(1, { x: 0, y: 0, z: 0 }, 2),
        b = landscapePoint(2, { x: 8, y: 0, z: 0 }, 2);
    const g: LandscapeSpline = { points: [a, b], segments: [] },
        s = connectLandscape(g, a, b)!;
    const entry = { ...landscapeMesh(), mesh: 'first' };
    s.meshes = [entry];
    s.drawDistance = 3;
    const update = (eye: number[]) => renderer.update(app, 0 as Entity, g, eye, null, { x: 0, y: 0, z: 0 }, 0, 1, 0);
    await vi.waitFor(() => {
        update([0, 0, 0]);
        expect(live.size).toBeGreaterThan(1);
    });
    update([100, 0, 0]);
    expect([...live.values()].every((r) => (r as { enabled: boolean }).enabled === false)).toBe(true);
    const previous = [...live.keys()];
    entry.mesh = 'slow';
    update([0, 0, 0]);
    expect([...live.keys()]).toEqual(previous);
    entry.mesh = 'final';
    update([0, 0, 0]);
    finish!();
    await vi.waitFor(() => {
        update([0, 0, 0]);
        expect(released).toContain('first');
        expect(released).toContain('slow');
    });
    expect([...live.keys()].every((e) => !previous.includes(e))).toBe(true);
    renderer.drop(app, 0 as Entity);
    expect(live.size).toBe(0);
    expect(released).toContain('final');
    expect(assets.releaseBuiltMesh).toHaveBeenCalledTimes(assets.createMesh.mock.calls.length);
});

it('discovers point and segment assets for packages along with the terrain textures', () => {
    const p = landscapePoint(1, { x: 0, y: 1, z: 0 }, 3),
        q = landscapePoint(2, { x: 4, y: 0, z: 0 }, 3);
    p.mesh = 'gate.esmesh';
    const graph: LandscapeSpline = { points: [p, q], segments: [] };
    connectLandscape(graph, p, q)!.meshes = [{ ...landscapeMesh(), mesh: 'rail.esmesh', material: 'steel.esmaterial' }];
    expect(Terrain.discoverAssets!({ heightmap: 'h.png', landscapeSpline: graph })).toEqual([
        { type: 'image', path: 'h.png' },
        { type: 'mesh', path: 'gate.esmesh' },
        { type: 'mesh', path: 'rail.esmesh' },
        { type: 'material', path: 'steel.esmaterial' },
    ]);
    expect(Terrain.discoverAssets!({ heightmap: 'old.png' })).toEqual([{ type: 'image', path: 'old.png' }]);
});
