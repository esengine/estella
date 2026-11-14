// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    collisionGeometry.ts
 * @brief   Static triangles made while the game runs, for the physics world to collide with: tiles of terrain, and the like.
 *
 * @details A system that makes ground or walls as it goes (the terrain round what moves on it) puts its triangles here under keys of
 *          its own; the 3D physics world, when there is one, keeps one static body a piece and follows the pieces as they are set,
 *          replaced and deleted. Neither side knows the other: a server without physics still makes the pieces, and physics needs no
 *          terrain module. A piece is replaced whole, by setting a new object under its key.
 *
 *          Pieces arrive late: a heightmap is still being read when the game starts, a tile is still being cut as something
 *          crosses into it. A maker says where it still OWES pieces (`owe`), and the physics world holds what stands there
 *          still until they come, where otherwise it would fall through ground that is about to exist and never come back.
 */
import type { App } from '../app/app';
import { defineResource } from '../ecs/resource';
import type { Entity } from '../types';

/** One piece of static geometry, in world units. */
export interface CollisionPiece {
    /** The entity the piece belongs to: what a contact or a ray that hits it reports. */
    owner: Entity;
    /** Where the piece's positions are measured from, in the world. */
    origin: readonly [number, number, number];
    /** `vertexCount * 3` floats, relative to `origin`. */
    positions: Float32Array;
    /** Three a triangle, counter-clockwise seen from the side that faces out. */
    indices: Uint32Array;
    friction: number;
    restitution: number;
    /** The collision layer (0 to 15). */
    layer: number;
}

/** Whether a maker still owes static geometry at a world place: pieces that will be there and are not yet. */
export type OwedAt = (x: number, y: number, z: number) => boolean;

/** The pieces now, by key. */
export class CollisionGeometry {
    private readonly pieces_ = new Map<string, CollisionPiece>();
    private readonly owed_ = new Map<string, OwedAt>();
    /** Bumped on every change, so a reader can skip a frame where nothing changed. */
    revision = 0;

    set(key: string, piece: CollisionPiece): void {
        this.pieces_.set(key, piece);
        this.revision++;
    }

    delete(key: string): void {
        if (this.pieces_.delete(key)) this.revision++;
    }

    get(key: string): CollisionPiece | undefined {
        return this.pieces_.get(key);
    }

    /** Deletes every piece whose key starts with `prefix`. */
    deleteAll(prefix: string): void {
        for (const key of [...this.pieces_.keys()]) if (key.startsWith(prefix)) this.delete(key);
    }

    entries(): IterableIterator<[string, CollisionPiece]> {
        return this.pieces_.entries();
    }

    get size(): number {
        return this.pieces_.size;
    }

    /**
     * Says where a maker still owes pieces, under a key of its own; setting it again replaces what it said. It is asked about the
     * places bodies stand at, each step, so it should be a lookup and not a search.
     */
    owe(key: string, at: OwedAt): void {
        this.owed_.set(key, at);
    }

    /** The maker under `key` owes nothing any more: it is gone, or makes no collision. */
    settle(key: string): void {
        this.owed_.delete(key);
    }

    /** Whether any maker has said where it owes pieces: with none, nothing needs asking. */
    get owing(): boolean {
        return this.owed_.size > 0;
    }

    /** Whether any maker still owes pieces at a world place: what stands there is held still until they come. */
    owedAt(x: number, y: number, z: number): boolean {
        for (const at of this.owed_.values()) if (at(x, y, z)) return true;
        return false;
    }
}

export const CollisionGeometryRes = defineResource<CollisionGeometry>(new CollisionGeometry(), 'CollisionGeometry');

/** The app's collision geometry, installed on first use. */
export function collisionGeometryOf(app: App): CollisionGeometry {
    if (!app.hasResource(CollisionGeometryRes)) app.insertResource(CollisionGeometryRes, new CollisionGeometry());
    return app.getResource(CollisionGeometryRes);
}
