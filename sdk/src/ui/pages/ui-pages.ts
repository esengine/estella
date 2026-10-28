// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui-pages.ts
 * @brief   Pages of a UI that exist only while someone wants them.
 *
 * A screen with a dozen pages, each a prefab of hundreds or thousands of entities, does not need all of them in the world at
 * once: the ones nobody has opened still cost the load their entities take to make, the memory they hold, and — hidden or not —
 * a share of every pass that walks the UI. `UIPages` keeps the pages as prefabs and makes one when it is first opened.
 *
 *   • A page is registered with the prefab it is made from, where it goes and what closing it does.
 *   • `open(id)` builds the page the first time (several callers asking at once share one build), switches it on, and answers a
 *     handle that finds the page's nodes by name — inside the page, so two pages may use the same name.
 *   • `close(id)` switches it off ("keep": the next open is instant) or takes its contents out of the world ("destroy": the
 *     memory comes back and the next open builds it again).
 *
 * Where a page goes is one of two things. A `parent` takes a new root added under it, last among its children. A `mount` is an
 * entity already in the scene: the page's contents are built under it, so the page keeps the place the mount has in the draw
 * order (a UI's overlays are above its screens because they come after them, and a page built later must not end up on top of
 * an overlay). The mount carries what the prefab's root would have carried; only the root's children are taken.
 */
import { Children, Name, Parent } from '../../ecs/component';
import type { ChildrenData, NameData, ParentData } from '../../ecs/component';
import { isEntityActive, setEntityActive } from '../../ecs/entityUtils';
import { instantiatePrefab } from '../../prefab';
import type { PrefabData, PrefabOverride } from '../../prefab';
import { deferredEntities, deferredRecord } from '../../scene/deferredInstances';
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';

import type { Assets } from '../../asset/Assets';

export interface PageDef {
    /** The prefab the page is made from: a path or `@uuid:` reference, whatever the asset system loads a prefab by. */
    prefab: string;
    /** An entity of the scene to build the page's contents under (see the file comment). One of `mount` and `parent` is needed. */
    mount?: Entity | (() => Entity);
    /** An entity to add the page's root under, last among its children. */
    parent?: Entity | (() => Entity);
    /** Overrides applied to the prefab as it is built, as a scene's prefab instance carries them. */
    overrides?: PrefabOverride[];
    /**
     * What closing does. `keep` (the default): the page stays built and is switched off, so opening it again costs nothing.
     * `destroy`: its contents are removed and the next open builds them again.
     */
    onClose?: 'keep' | 'destroy';
}

/** A built page: its root, and its nodes by name. */
export interface PageHandle {
    readonly id: string;
    /** The page's root: the mount, or the prefab's own root when the page was given a `parent`. */
    readonly root: Entity;
    /** The node called `name` inside this page, if there is one. */
    find(name: string): Entity | undefined;
    has(name: string): boolean;
    /** Every name in the page, for a caller that wires them all. */
    names(): IterableIterator<string>;
}

interface PageState {
    def: PageDef;
    handle: PageHandle | null;
    building: Promise<PageHandle> | null;
    open: boolean;
}

const resolve = (at: Entity | (() => Entity)): Entity => (typeof at === 'function' ? at() : at);

export class UIPages {
    private readonly pages_ = new Map<string, PageState>();
    private readonly builtListeners_: Array<(page: PageHandle) => void> = [];
    private readonly prefabs_ = new Map<string, Promise<PrefabData>>();
    private readonly mounts_ = new Set<Entity>();

    constructor(private readonly world_: World, private readonly assets_: Assets) {}

    register(id: string, def: PageDef): void {
        if (this.pages_.has(id)) throw new Error(`UIPages: page "${id}" is already registered`);
        if (def.mount === undefined && def.parent === undefined) throw new Error(`UIPages: page "${id}" needs a mount or a parent`);
        this.pages_.set(id, { def, handle: null, building: null, open: false });
    }

    has(id: string): boolean { return this.pages_.has(id); }

    /**
     * Register a virtual instance of the scene (prefab/deferred.ts) as a page named after its root: the root is the mount, and the
     * prefab and overrides are the ones the instance was made from. Answers the page's id, or null when the entity is not a virtual
     * instance or is already registered.
     */
    registerDeferred(entity: Entity, onClose: PageDef['onClose'] = 'keep'): string | null {
        const record = deferredRecord(this.world_, entity);
        if (record === undefined || this.mounts_.has(entity)) return null;
        const name = this.world_.has(entity, Name) ? (this.world_.get(entity, Name) as NameData).value : '';
        if (name === '') throw new Error(`UIPages: a virtual instance needs a name to be a page (entity ${entity})`);
        this.register(name, { prefab: record.prefab, mount: entity, overrides: record.overrides, onClose });
        this.mounts_.add(entity);
        return name;
    }

    /** Register every virtual instance of the world — or only those under `root` — that is not a page yet. Answers their ids. */
    registerDeferredAll(root?: Entity, onClose: PageDef['onClose'] = 'keep'): string[] {
        const ids: string[] = [];
        for (const entity of deferredEntities(this.world_)) {
            if (root !== undefined && !this.isUnder_(entity, root)) continue;
            const id = this.registerDeferred(entity, onClose);
            if (id !== null) ids.push(id);
        }
        return ids;
    }

    /** Whether the page has been built (and not destroyed since). */
    isBuilt(id: string): boolean { return this.state_(id).handle !== null; }

    /** Whether the page is open: built and switched on. */
    isOpen(id: string): boolean { return this.state_(id).open; }

    /** The page's handle, once it has been built. */
    page(id: string): PageHandle | null { return this.state_(id).handle; }

    /** Called each time a page is built, after its contents exist and before the `open` that asked for it answers: the place to wire it. */
    onBuilt(listener: (page: PageHandle) => void): () => void {
        this.builtListeners_.push(listener);
        return () => { const i = this.builtListeners_.indexOf(listener); if (i >= 0) this.builtListeners_.splice(i, 1); };
    }

    /** Fetch the page's prefab now, so that building it later is only making entities. */
    preload(id: string): Promise<void> {
        return this.prefab_(this.state_(id).def.prefab).then(() => undefined);
    }

    async open(id: string): Promise<PageHandle> {
        const state = this.state_(id);
        if (state.handle === null) {
            state.building ??= this.build_(id, state).finally(() => { state.building = null; });
            state.handle = await state.building;
        }
        if (!state.open || !isEntityActive(this.world_, state.handle.root)) setEntityActive(this.world_, state.handle.root, true);
        state.open = true;
        return state.handle;
    }

    close(id: string): void {
        const state = this.state_(id);
        if (!state.open && state.handle === null) return;
        state.open = false;
        const handle = state.handle;
        if (handle === null) return;
        if (state.def.onClose === 'destroy') this.destroy_(state, handle);
        else if (this.world_.valid(handle.root)) setEntityActive(this.world_, handle.root, false);
    }

    private state_(id: string): PageState {
        const state = this.pages_.get(id);
        if (!state) throw new Error(`UIPages: no page "${id}"`);
        return state;
    }

    private prefab_(ref: string): Promise<PrefabData> {
        let p = this.prefabs_.get(ref);
        if (!p) {
            p = this.assets_.loadPrefab(ref).then((r) => r.data as PrefabData);
            p.catch(() => this.prefabs_.delete(ref));
            this.prefabs_.set(ref, p);
        }
        return p;
    }

    private async build_(id: string, state: PageState): Promise<PageHandle> {
        const { def } = state;
        const prefab = await this.prefab_(def.prefab);
        const world = this.world_;
        const made = await instantiatePrefab(world, prefab, {
            assets: this.assets_,
            overrides: def.overrides,
            parent: def.mount === undefined ? resolve(def.parent!) : undefined,
        });
        let root = made.root;
        if (def.mount !== undefined) {
            const mount = resolve(def.mount);
            // The prefab came up as a root of its own. Its children move under the mount, in order, and the empty root goes.
            const children = world.has(root, Children) ? [...(world.get(root, Children) as ChildrenData).entities] : [];
            for (const child of children) world.setParent(child, mount);
            world.despawn(root);
            root = mount;
        }
        const names = this.nameIndex_(root);
        const handle: PageHandle = {
            id, root,
            find: (name) => names.get(name),
            has: (name) => names.has(name),
            names: () => names.keys(),
        };
        // Virtual instances inside the page that was just made are pages too, to be opened when they are wanted.
        this.registerDeferredAll(root, def.onClose);
        for (const listener of [...this.builtListeners_]) listener(handle);
        return handle;
    }

    private isUnder_(entity: Entity, root: Entity): boolean {
        const world = this.world_;
        let at = entity;
        for (let hops = 0; hops < 256 && world.valid(at); hops++) {
            if (at === root) return true;
            if (!world.has(at, Parent)) return false;
            at = (world.get(at, Parent) as ParentData).entity;
        }
        return false;
    }

    /** Names are only looked for inside the page, depth first; where one is used twice the first one wins. */
    private nameIndex_(root: Entity): Map<string, Entity> {
        const world = this.world_, index = new Map<string, Entity>();
        const walk = (entity: Entity): void => {
            if (world.has(entity, Name)) {
                const name = (world.get(entity, Name) as NameData).value;
                if (name !== '' && !index.has(name)) index.set(name, entity);
            }
            if (world.has(entity, Children)) for (const child of (world.get(entity, Children) as ChildrenData).entities) walk(child);
        };
        walk(root);
        return index;
    }

    private destroy_(state: PageState, handle: PageHandle): void {
        const world = this.world_;
        if (state.def.mount !== undefined) {
            // The mount belongs to the scene and stays, switched off like any closed page; what was built under it goes.
            if (world.has(handle.root, Children)) for (const child of [...(world.get(handle.root, Children) as ChildrenData).entities]) world.despawn(child);
            setEntityActive(world, handle.root, false);
        } else if (world.valid(handle.root)) {
            world.despawn(handle.root);
        }
        state.handle = null;
    }
}
