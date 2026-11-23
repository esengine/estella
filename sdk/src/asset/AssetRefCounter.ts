// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AssetRefCounter.ts
 * @brief   Optional asset reference counting for debugging and monitoring
 */
import type { World } from '../ecs/world';
import type { AnyComponentDef } from '../ecs/component';
import type { Entity } from '../types';

const manual = Symbol('explicit asset reference');
type FieldObserver = (world: World, entity: Entity, component: AnyComponentDef) => void;

export interface AssetRefInfo {
    assetPath: string;
    refCount: number;
    /** One number per live user. Different Worlds can allocate the same number. */
    entities: number[];
}

interface AssetUser {
    entity: number;
    world?: World;
    paths: Map<RefMap, Map<string, Set<symbol>>>;
}

interface WorldUsers {
    users: Map<number, AssetUser>;
    observers?: Map<Entity, FieldObserver>;
    offFields?(): void;
    unbind?(): void;
}

class RefMap {
    private refs_ = new Map<string, Set<AssetUser>>();
    private rows_ = 0;

    add(path: string, user: AssetUser, source: symbol): void {
        let paths = user.paths.get(this);
        if (!paths) user.paths.set(this, paths = new Map());
        const sources = paths.get(path);
        if (sources) { sources.add(source); return; }
        paths.set(path, new Set([source]));
        let refs = this.refs_.get(path);
        if (!refs) {
            refs = new Set();
            this.refs_.set(path, refs);
        }
        refs.add(user);
        this.rows_++;
    }

    remove(path: string, user: AssetUser, source?: symbol): void {
        if (source !== undefined) {
            const sources = user.paths.get(this)?.get(path);
            if (!sources?.delete(source) || sources.size) return;
        }
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

    /** @internal Replace one component's contribution. Each entity still counts once per path. */
    syncComponent(world: World | undefined, entity: Entity, component: AnyComponentDef, data: Record<string, unknown> | null,
                  pathFor: (type: string, handle: number) => string | null): void {
        // A legacy caller with no World supplies a snapshot and owns the resulting diagnostic rows.
        const source = world ? component._id : manual;
        const current: { kind: RefMap; path: string }[] = [];
        if (data) for (const { field, type } of component.assetFields) {
            const handle = data[field];
            if (!handle || typeof handle !== 'number') continue;
            const kind = type === 'texture' ? this.textures_ : type === 'material' ? this.materials_ : type === 'font' ? this.fonts_ : null;
            const path = kind && pathFor(type, handle);
            if (kind && path != null) {
                current.push({ kind, path });
                this.add_(kind, path, entity, world, source);
            }
        }
        if (!world) return;
        const user = this.worlds_.get(world)?.users.get(entity);
        if (!user) return;
        for (const [kind, paths] of user.paths) {
            for (const [path, sources] of paths) {
                if (sources.has(source) && !current.some(ref => ref.kind === kind && ref.path === path)) kind.remove(path, user, source);
            }
        }
        if (!user.paths.size) this.pruneUser_(user);
    }

    /** @internal A standalone scene has no app-wide asset binding. Follow only its published entities. */
    observeEntity(world: World, entity: Entity, observer: FieldObserver): void {
        if (world.isDestructionPending(entity)) return;
        const entry = this.entry_(world);
        if (!entry.observers) {
            const observers = entry.observers = new Map<Entity, FieldObserver>();
            entry.offFields = world.onAssetFieldsChanged((id, component) => observers.get(id)?.(world, id, component));
        }
        entry.observers.set(entity, observer);
    }

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
                    for (const path of paths.keys()) this.add_(kind, path, user.entity, world);
                }
                this.clearUser_(user);
            }
        }
        return true;
    }

    private entry_(world: World | undefined): WorldUsers {
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
        return entry;
    }

    private add_(kind: RefMap, path: string, entity: number, world = this.defaultWorld_, source = manual): void {
        if (world?.isDestructionPending(entity)) return;
        const entry = this.entry_(world);
        let user = entry.users.get(entity);
        if (!user) {
            user = { entity, world, paths: new Map() };
            entry.users.set(entity, user);
        }
        kind.add(path, user, source);
    }

    private remove_(entity: number, world = this.defaultWorld_, kind?: RefMap, path?: string): void {
        const owner = this.worlds_.get(world);
        if (!kind && owner?.observers?.delete(entity) && !owner.observers.size && !owner.users.size) this.clearWorld_(world);
        let user = owner?.users.get(entity);
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
        if (kind && path !== undefined) {
            // Give back an explicit registration first. A caller can also clear a scene-only diagnostic row.
            const source = user.paths.get(kind)?.get(path)?.has(manual) ? manual : undefined;
            kind.remove(path, user, source);
        } else this.clearUser_(user);
        if (!user.paths.size) this.pruneUser_(user);
    }

    private pruneUser_(user: AssetUser): void {
        const entry = this.worlds_.get(user.world)!;
        entry.users.delete(user.entity);
        if (!entry.users.size && !entry.observers?.size) this.clearWorld_(user.world);
    }

    private clearUser_(user: AssetUser): void {
        for (const [kind, paths] of user.paths) {
            for (const path of paths.keys()) kind.remove(path, user);
        }
    }

    private clearWorld_(world: World | undefined): void {
        const entry = this.worlds_.get(world);
        if (!entry) return;
        this.worlds_.delete(world);
        entry.unbind?.();
        entry.offFields?.();
        for (const user of entry.users.values()) this.clearUser_(user);
    }

    clear(): void {
        for (const entry of this.worlds_.values()) { entry.unbind?.(); entry.offFields?.(); }
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
