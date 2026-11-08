// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    static-proxy.ts
 * @brief   Bake one procedural cluster for native material and shadow parity checks.
 */
import { builtinMeshTemplate, composeTRS, encodeMesh } from 'esengine';
import { bakeStaticProxy, type StaticProxySource } from '../../pipeline/src/world/staticProxy';

export async function staticProxyFixture() {
    const origin = [17, 1, -11] as const;
    const sources: StaticProxySource[] = [], entities: any[] = [], fullIds: number[] = [];
    const assets: Record<string, Uint8Array> = {};
    const comp = (type: string, data: unknown) => ({ type, data });
    const add = (id: number, name: string, components: unknown[]) => entities.push({ id, name, parent: null, children: [], visible: true, components });
    for (let i = 0; i < 18; i++) {
        const mesh = i % 2 ? 'builtin:cylinder' : 'builtin:cube';
        const position = { x: origin[0] + (i % 6 - 2.5) * 0.7, y: origin[1] + 0.3, z: origin[2] + (Math.floor(i / 6) - 1) * 0.7 };
        const rotation = { x: 0, y: Math.sin(i * 0.07), z: 0, w: Math.cos(i * 0.07) };
        const scale = { x: i % 5 ? 0.005 : -0.005, y: 0.006, z: 0.005 };
        const color = i % 3 ? { r: 0.2, g: 0.7, b: 0.8, a: 1 } : { r: 0.8, g: 0.3, b: 0.15, a: 1 };
        const state = { material: 0, texture: 0, normalMap: 0, color, layer: 0, cullBackfaces: false,
            castShadows: i % 4 !== 0, lit: true, parallax: { x: 1, y: 1 }, group: '' };
        const id = 100 + i;
        sources.push({ entity: id, mesh: builtinMeshTemplate(mesh)!.build(), world: composeTRS(position, rotation, scale),
            state, motion: 'static', blended: false });
        fullIds.push(id);
        // Symmetric primitives provide an independent reference for mirrored placements.
        add(id, `Source ${i}`, [comp('Transform', { position, rotation, scale: { ...scale, x: Math.abs(scale.x) } }),
            comp('MeshRenderer', { mesh, ...state, opaque: true })]);
    }
    const exact = await bakeStaticProxy(sources, { origin, ratio: 1, maxWorldError: 0 });
    const coarse = await bakeStaticProxy(sources, { origin, ratio: 0.2, maxWorldError: 0.01 });
    const emit = (result: typeof exact, start: number, label: string) => result.groups.map((group, i) => {
        const id = start + i, mesh = `/proxy/${label}-${i}.esmesh`;
        assets[mesh] = encodeMesh(group.mesh);
        add(id, `${label} ${i}`, [comp('Transform', { position: { x: origin[0], y: origin[1], z: origin[2] } }),
            comp('MeshRenderer', { ...group.state, mesh, opaque: true, enabled: false })]);
        return id;
    });
    const exactIds = emit(exact, 200, 'exact'), coarseIds = emit(coarse, 300, 'coarse');
    add(1, 'Camera', [comp('Transform', { position: { x: 17, y: 4, z: -4 },
        rotation: { x: Math.sin(-0.19), y: 0, z: 0, w: Math.cos(-0.19) } }),
    comp('Camera', { isActive: true, projectionType: 0, fov: 50, nearPlane: 0.1, farPlane: 100 })]);
    add(2, 'Sun', [comp('Transform', { rotation: { x: -0.3826834324, y: 0, z: 0, w: 0.9238795325 } }),
        comp('Light', { type: 1, intensity: 1.1, meshShadows: true, shadowExtent: 12 })]);
    add(3, 'Ground', [comp('Transform', { position: { x: 17, y: 0.95, z: -11 }, scale: { x: 0.065, y: 1, z: 0.04 } }),
        comp('MeshRenderer', { mesh: 'builtin:plane', lit: true, opaque: true, color: { r: 0.65, g: 0.6, b: 0.55, a: 1 } })]);
    return { scene: { version: 4, name: 'Static proxy validation', entities }, assets, fullIds, exactIds, coarseIds,
        statistics: { sources: sources.length, groups: exact.groups.length,
            fullTriangles: exact.groups.reduce((n, g) => n + g.trianglesBefore, 0),
            coarseTriangles: coarse.groups.reduce((n, g) => n + g.trianglesAfter, 0) } };
}
