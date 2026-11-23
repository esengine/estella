// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AssetRefCounter.ts
 * @brief   Optional asset reference counting for debugging and monitoring
 */
import type { World } from '../ecs/world';

export interface AssetRefInfo {
    assetPath: string;
    refCount: number;
    /** One number per live user. Different Worlds can allocate the same number. */
    entities: number[];
}

interface AssetUser {
    entity: number;
    world?: World;
    paths: Map<RefMap, Set<string>>;
}

interface WorldUsers {
    users: Map<number, AssetUser>;
    unbind?(): void;
}

class RefMap {
    private refs_ = new Map<string, Set<AssetUser>>();
    private rows_ = 0;

    add(path: string, user: AssetUser): void {
        let refs = this.refs_.get(path);
        if (!refs) {
            refs = new Set();
            this.refs_.set(path, refs);
        }
        if (refs.has(user)) return;
        refs.add(user);
        let paths = user.paths.get(this);
        if (!paths) user.paths.set(this, paths = new Set());
        paths.add(path);
        this.rows_++;
    }

    remove(path: string, user: AssetUser): void {
        const refs = this.refs_.get(path);
        if (refs?.delete(user)) {
            this.rows_--;
            if (refs.size === 0) this.refs_.delete(path);
            const paths = user.paths.get(this)!;
            paths.delete(path);
            if (!paths.size) user.paths.delete(this);
        }
    }

    getCount(path: string, world?: World): number {
        const users = this.refs_.get(path);
        if (!world || !users) return users?.size ?? 0;
        let count = 0;
        for (const user of users) if (user.world === world) count++;
        return count;
    }

    getRefs(path: string, world?: World): number[] {
        const entities: number[] = [];
        for (const user of this.refs_.get(path) ?? []) {
            if (!world || user.world === world) entities.push(user.entity);
        }
        return entities;
    }

    getAll(world?: World): AssetRefInfo[] {
        const result: AssetRefInfo[] = [];
        for (const path of this.refs_.keys()) {
            const entities = this.getRefs(path, world);
            if (entities.length) result.push({ assetPath: path, refCount: entities.length, entities });
        }
        return result;
    }

    get size(): number { return this.refs_.size; }

    get rows(): number {
        return this.rows_;
    }

    clear(): void { this.refs_.clear(); this.rows_ = 0; }
}

/** Reads aggregate across Worlds unless a World is supplied. Unqualified app writes use its World. */
export class AssetRefCounter {
    private textures_ = new RefMap();
    private fonts_ = new RefMap();
    private materials_ = new RefMap();
    private readonly worlds_ = new Map<World | undefined, WorldUsers>();
    private defaultWorld_?: World;

    addTextureRef(path: string, entity: number, world?: World): void { this.add_(this.textures_, path, entity, world); }
    removeTextureRef(path: string, entity: number, world?: World): void { this.remove_(entity, world, this.textures_, path); }
    getTextureRefCount(path: string, world?: World): number { return this.textures_.getCount(path, world); }
    getTextureRefs(path: string, world?: World): number[] { return this.textures_.getRefs(path, world); }
    getAllTextureRefs(world?: World): AssetRefInfo[] { return this.textures_.getAll(world); }

    addFontRef(path: string, entity: number, world?: World): void { this.add_(this.fonts_, path, entity, world); }
    removeFontRef(path: string, entity: number, world?: World): void { this.remove_(entity, world, this.fonts_, path); }
    getFontRefCount(path: string, world?: World): number { return this.fonts_.getCount(path, world); }
    getFontRefs(path: string, world?: World): number[] { return this.fonts_.getRefs(path, world); }
    getAllFontRefs(world?: World): AssetRefInfo[] { return this.fonts_.getAll(world); }

    addMaterialRef(path: string, entity: number, world?: World): void { this.add_(this.materials_, path, entity, world); }
    removeMaterialRef(path: string, entity: number, world?: World): void { this.remove_(entity, world, this.materials_, path); }
    getMaterialRefCount(path: string, world?: World): number { return this.materials_.getCount(path, world); }
    getMaterialRefs(path: string, world?: World): number[] { return this.materials_.getRefs(path, world); }
    getAllMaterialRefs(world?: World): AssetRefInfo[] { return this.materials_.getAll(world); }

    removeAllRefsForEntity(entity: number, world?: World): void {
        this.remove_(entity, world);
    }

    /** @internal Adopt existing unqualified rows on the first app binding. */
    bindDefaultWorld(world: World): boolean {
        if (this.defaultWorld_) return false;
        this.defaultWorld_ = world;
        const legacy = this.worlds_.get(undefined);
        if (legacy) {
            this.worlds_.delete(undefined);
            for (const user of legacy.users.values()) {
                for (const [kind, paths] of user.paths) {
                    for (const path of paths) this.add_(kind, path, user.entity, world);
                }
                this.clearUser_(user);
            }
        }
        return true;
    }

    private add_(kind: RefMap, path: string, entity: number, world = this.defaultWorld_): void {
        if (world?.isDestructionPending(entity)) return;
        let entry = this.worlds_.get(world);
        if (!entry) {
            entry = { users: new Map() };
            this.worlds_.set(world, entry);
            if (world) {
                const offDespawn = world.onDespawn(id => this.removeAllRefsForEntity(id, world));
                const offCore = world.onCoreDisconnect(() => this.clearWorld_(world));
                entry.unbind = () => { offDespawn(); offCore(); };
            }
        }
        let user = entry.users.get(entity);
        if (!user) {
            user = { entity, world, paths: new Map() };
            entry.users.set(entity, user);
        }
        kind.add(path, user);
    }

    private remove_(entity: number, world = this.defaultWorld_, kind?: RefMap, path?: string): void {
        let user = this.worlds_.get(world)?.users.get(entity);
        if (!world && !user) {
            // A standalone numeric caller can still remove a scene user when its World is unambiguous.
            for (const entry of this.worlds_.values()) {
                const found = entry.users.get(entity);
                if (!found) continue;
                if (user) return;
                user = found;
            }
        }
        if (!user) return;
        if (kind && path !== undefined) kind.remove(path, user);
        else this.clearUser_(user);
        if (user.paths.size) return;
        const entry = this.worlds_.get(user.world)!;
        entry.users.delete(entity);
        if (!entry.users.size) this.clearWorld_(user.world);
    }

    private clearUser_(user: AssetUser): void {
        for (const [kind, paths] of user.paths) {
            for (const path of paths) kind.remove(path, user);
        }
    }

    private clearWorld_(world: World | undefined): void {
        const entry = this.worlds_.get(world);
        if (!entry) return;
        this.worlds_.delete(world);
        entry.unbind?.();
        for (const user of entry.users.values()) this.clearUser_(user);
    }

    clear(): void {
        for (const entry of this.worlds_.values()) entry.unbind?.();
        this.worlds_.clear();
        this.textures_.clear();
        this.fonts_.clear();
        this.materials_.clear();
    }

    getTotalRefCount(): { textures: number; fonts: number; materials: number } {
        return {
            textures: this.textures_.size,
            fonts: this.fonts_.size,
            materials: this.materials_.size,
        };
    }

    /**
     * Total (asset, entity) pairs held, across every kind — the number a
     * spawn/despawn round trip must conserve.
     *
     * {@link getTotalRefCount} counts distinct PATHS, which understates a leak:
     * ten thousand entities that never released one texture read as a single ref.
     */
    getTotalRefRows(): number {
        return this.textures_.rows + this.fonts_.rows + this.materials_.rows;
    }
}
