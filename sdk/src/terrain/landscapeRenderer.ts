// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App } from '../app/app';
import type { Entity, Vec3 } from '../types';
import { MeshRenderer, Transform } from '../ecs/component';
import { playModeOnly } from '../ecs/env';
import { Assets } from '../asset/AssetPlugin';
import { AssetScope } from '../asset/AssetLease';
import type { MaterialResult } from '../asset/AssetLoader';
import type { MeshData } from '../asset/meshFormat';
import { extractPositions } from '../asset/meshCollision';
import { collisionGeometryOf } from '../runtime/collisionGeometry';
import { Material } from '../render/material';
import { BlendMode } from '../render/blend';
import { log } from '../util/logger';
import type { LandscapeSpline, LandscapeSegment } from './landscapeSpline';
import { landscapeSpans } from './landscapeSpline';
import { deformLandscapeMesh, landscapePieces, landscapePointMesh } from './landscapeMesh';
import type { TiledSource } from './tiles';

interface Item {
    mesh: MeshData;
    material: number;
    segment?: LandscapeSegment;
    child?: Entity;
    handle?: number;
    collision?: string;
    visible?: boolean;
}
interface Batch {
    key: string;
    items: Item[];
    scope: AssetScope;
}
export class LandscapeRenderer {
    private readonly batches = new Map<Entity, Batch>();
    private readonly building = new Map<Entity, Batch>();
    drop(app: App, owner: Entity): void {
        this.building.delete(owner);
        const b = this.batches.get(owner);
        if (!b) return;
        this.batches.delete(owner);
        for (const item of b.items) this.remove(app, item);
        b.scope.releaseAll();
    }
    private remove(app: App, item: Item): void {
        if (item.collision) collisionGeometryOf(app).delete(item.collision);
        if (item.child !== undefined && app.world.valid(item.child)) app.world.despawn(item.child);
        if (item.handle) app.getResource(Assets).releaseBuiltMesh(item.handle);
        item.child = undefined;
        item.handle = undefined;
        item.collision = undefined;
        item.visible = undefined;
    }
    update(
        app: App,
        owner: Entity,
        graph: LandscapeSpline | undefined,
        eye: readonly number[] | null,
        tile: TiledSource | null,
        origin: Vec3,
        layer: number,
        friction: number,
        revision: number,
    ): void {
        if (!graph?.segments.length && !graph?.points.some((p) => p.mesh)) {
            this.drop(app, owner);
            return;
        }
        const key = revision + JSON.stringify(graph);
        const visible = this.batches.get(owner);
        if (visible?.key === key) this.building.delete(owner);
        else if (this.building.get(owner)?.key !== key) {
            const pending = { key, items: [], scope: new AssetScope() };
            this.building.set(owner, pending);
            void this.build(app, owner, pending, graph);
        }
        if (!visible) return;
        for (const [i, item] of visible.items.entries()) {
            const s = item.segment,
                m = item.mesh;
            const x = (m.aabbMin[0] + m.aabbMax[0]) / 2,
                z = (m.aabbMin[2] + m.aabbMax[2]) / 2;
            if (s?.stream && tile && !tile.residentAt(x, z)) {
                if (item.child !== undefined) this.remove(app, item);
                continue;
            }
            if (item.child === undefined) {
                const handle = app.getResource(Assets).createMesh(m);
                if (!handle) continue;
                const e = app.world.spawn('LandscapeSplineMesh');
                item.child = e;
                item.handle = handle;
                app.world.insert(e, Transform, {});
                app.world.setParent(e, owner);
                const transparent = !!item.material && Material.getBlendMode(item.material) !== BlendMode.None;
                app.world.insert(e, MeshRenderer, {
                    mesh: handle,
                    material: item.material,
                    castShadows: s?.castShadow ?? true,
                    opaque: !transparent,
                    layer: transparent ? (s?.sortPriority ?? 0) : 0,
                });
            }
            const cx = Math.max(m.aabbMin[0], Math.min(eye?.[0] ?? x, m.aabbMax[0])),
                cz = Math.max(m.aabbMin[2], Math.min(eye?.[2] ?? z, m.aabbMax[2]));
            const cy = Math.max(m.aabbMin[1], Math.min(eye?.[1] ?? 0, m.aabbMax[1]));
            const show =
                !(s?.hidden && playModeOnly()) &&
                !(s?.drawDistance && eye && Math.hypot(eye[0]! - cx, eye[1]! - cy, eye[2]! - cz) > s.drawDistance);
            if (show !== item.visible) {
                const renderer = app.world.get(item.child, MeshRenderer);
                app.world.set(item.child, MeshRenderer, { ...renderer, enabled: show });
                item.visible = show;
            }
            if (s && s.collisionProfile !== 'None') {
                const id = owner + ':spline:' + i,
                    ck = [id, origin.x, origin.y, origin.z, layer, friction].join('/');
                if (item.collision === ck) continue;
                if (item.collision) collisionGeometryOf(app).delete(item.collision);
                const positions = extractPositions(m.vertices, m.vertexCount, m.vertexStride, m.channels);
                if (positions) {
                    const fixed = /^Layer (\d+)$/.exec(s.collisionProfile);
                    collisionGeometryOf(app).set(ck, {
                        owner,
                        positions,
                        indices: m.indices,
                        origin: [origin.x, origin.y, origin.z],
                        layer: fixed ? Number(fixed[1]) : layer,
                        friction,
                        restitution: 0,
                    });
                    item.collision = ck;
                }
            }
        }
    }
    private async build(app: App, owner: Entity, batch: Batch, graph: LandscapeSpline): Promise<void> {
        const assets = app.getResource(Assets),
            scope = new AssetScope(),
            meshes = new Map<string, MeshData>(),
            materials = new Map<string, number>();
        const entries = [...graph.points, ...graph.segments.flatMap((s) => s.meshes)];
        try {
            // Each acquisition has an owner even if the graph changes while the files arrive.
            await Promise.all(
                [...new Set(entries.map((e) => e.mesh).filter(Boolean))].map(async (ref) => {
                    try {
                        const lease = scope.add(await assets.acquireTyped<{ handle: number }>('mesh', ref));
                        const data = await assets.readMeshData(lease.value.handle);
                        if (data) meshes.set(ref, data);
                    } catch (e) {
                        log.warn('terrain', 'Reading spline mesh ' + ref + ' failed', e);
                    }
                }),
            );
            if (this.building.get(owner) !== batch) return;
            await Promise.all(
                [...new Set(entries.map((e) => e.material).filter(Boolean))].map(async (ref) => {
                    try {
                        materials.set(ref, scope.add(await assets.acquireTyped<MaterialResult>('material', ref)).value.handle);
                    } catch (e) {
                        log.warn('terrain', 'Reading spline material ' + ref + ' failed', e);
                    }
                }),
            );
            if (this.building.get(owner) !== batch) return;
            for (const p of graph.points) {
                const src = meshes.get(p.mesh),
                    mesh = src && landscapePointMesh(src, p);
                if (mesh) batch.items.push({ mesh, material: materials.get(p.material) ?? 0 });
            }
            for (const span of landscapeSpans(graph))
                for (const piece of landscapePieces(span, meshes)) {
                    const mesh = deformLandscapeMesh(span, piece);
                    if (mesh) batch.items.push({ mesh, material: materials.get(piece.entry.material) ?? 0, segment: span.segment });
                }
            this.drop(app, owner);
            batch.scope.absorb(scope);
            this.batches.set(owner, batch);
        } catch (e) {
            log.warn('terrain', 'Building landscape spline meshes failed', e);
        } finally {
            scope.releaseAll();
        }
    }
}
