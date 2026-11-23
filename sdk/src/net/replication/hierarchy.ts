// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { Parent } from '../../ecs/component';
import { ComponentMutationReader } from '../../ecs/ComponentMutationReader';
import { detachSurvivingDescendants, parentEntity } from '../../ecs/hierarchy';
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import type { NetIds } from './NetIds';
import type { ReplParentUpdate } from './protocol';

/** One parent per child. An absent network identity may still have children waiting for it. */
class ParentLinks<Id extends number> {
    private readonly parents = new Map<Id, Id>();
    private readonly children = new Map<Id, Set<Id>>();

    parentOf(child: Id): Id | undefined { return this.parents.get(child); }
    childrenOf(parent: Id): ReadonlySet<Id> | undefined { return this.children.get(parent); }

    set(child: Id, parent: Id | undefined): void {
        const previous = this.parents.get(child);
        if (previous === parent) return;
        if (previous !== undefined) {
            const siblings = this.children.get(previous)!;
            siblings.delete(child);
            if (siblings.size === 0) this.children.delete(previous);
        }
        if (parent === undefined) {
            this.parents.delete(child);
            return;
        }
        this.parents.set(child, parent);
        const siblings = this.children.get(parent);
        if (siblings) siblings.add(child);
        else this.children.set(parent, new Set([child]));
    }

    clear(): void { this.parents.clear(); this.children.clear(); }
}

export interface ParentEntry { entity: Entity; link: ReplParentUpdate }

/** Observe structural edits and changes in the network identity of the same local parent. */
export class ServerHierarchy {
    private readonly links = new ParentLinks<Entity>();
    private readonly sent = new Map<Entity, number>();
    private readonly baselineChanges = new Set<Entity>();
    private readonly mutations: ComponentMutationReader;

    constructor(private readonly world: World, private readonly ids: NetIds) {
        this.mutations = new ComponentMutationReader(world, [Parent], [], []);
    }

    baseline(child: Entity): number {
        const wire = this.wireId(parentEntity(this.world, child));
        // A join can observe an edit between samples. Even if the parent then
        // changes back, that client needs the final link at the next sample.
        if (wire !== (this.sent.get(child) ?? 0)) this.baselineChanges.add(child);
        return wire;
    }

    private wireId(parent: Entity | undefined): number {
        return parent === undefined ? 0 : this.ids.netIdOf(parent) ?? 0;
    }

    private observe(child: Entity): number {
        const parent = parentEntity(this.world, child);
        this.links.set(child, parent);
        const wire = this.wireId(parent);
        if (wire) this.sent.set(child, wire);
        else this.sent.delete(child);
        return wire;
    }

    rebase(known: ReadonlySet<Entity>): void {
        this.clear();
        const batch = this.mutations.read();
        for (const e of known) this.observe(e);
        if (batch) this.mutations.commit(batch);
    }

    changes(known: ReadonlySet<Entity>, entered: Entity[], left: { entity: Entity }[]): ParentEntry[] {
        const batch = this.mutations.read();
        // A native reparent between two live parents announces the child as a
        // subtree root even when Parent already existed. Older cores can still
        // supply the current tree without a journal.
        const rescan = batch?.full ?? (this.world.getCppRegistry() !== null);
        const candidates = new Set(rescan ? known : batch?.entities);
        for (const child of this.baselineChanges) candidates.add(child);
        for (const e of entered) {
            for (const child of this.links.childrenOf(e) ?? []) candidates.add(child);
        }
        for (const { entity } of left) {
            for (const child of this.links.childrenOf(entity) ?? []) candidates.add(child);
            this.links.set(entity, undefined);
            this.sent.delete(entity);
        }
        // Spawns already include their current link, even for forward references.
        for (const e of entered) {
            this.observe(e);
            candidates.delete(e);
        }
        const updates: ParentEntry[] = [];
        for (const child of candidates) {
            const netId = this.ids.netIdOf(child);
            if (netId === undefined || !known.has(child)) continue;
            const before = this.sent.get(child) ?? 0;
            const parentNetId = this.observe(child);
            if (parentNetId !== before || this.baselineChanges.has(child)) {
                updates.push({ entity: child, link: { netId, parentNetId } });
            }
        }
        if (batch) this.mutations.commit(batch);
        this.baselineChanges.clear();
        return updates;
    }

    pause(): void { this.mutations.pause(); }
    dispose(): void { this.mutations.dispose(); this.clear(); }

    private clear(): void {
        this.links.clear();
        this.sent.clear();
        this.baselineChanges.clear();
    }
}

export class GhostHierarchy {
    private readonly links = new ParentLinks<number>();

    constructor(private readonly world: World, private readonly ids: NetIds) {}

    apply(baselines: Iterable<ReplParentUpdate>, entered: Iterable<number>, updates?: ReplParentUpdate[]): void {
        const affected = new Set<number>();
        const remember = ({ netId, parentNetId }: ReplParentUpdate) => {
            const child = this.ids.entityOf(netId);
            if (child === undefined) return;
            if (!parentNetId && this.links.parentOf(netId) === undefined) {
                // A root archetype can build under a client-only scene container.
                // An explicit release of an earlier server link still takes effect.
                const existing = parentEntity(this.world, child);
                if (existing === undefined || this.ids.netIdOf(existing) === undefined) return;
            }
            this.links.set(netId, parentNetId || undefined);
            affected.add(netId);
        };
        for (const link of baselines) remember(link);
        if (updates) for (const link of updates) remember(link);
        for (const parent of entered) {
            for (const child of this.links.childrenOf(parent) ?? []) affected.add(child);
        }
        this.project(affected);
    }

    project(netIds: Iterable<number>): void {
        const attach: [Entity, Entity][] = [];
        for (const id of netIds) {
            const child = this.ids.entityOf(id);
            if (child === undefined) continue;
            const wire = this.links.parentOf(id);
            const parent = wire === undefined ? undefined : this.ids.entityOf(wire);
            const previous = parentEntity(this.world, child);
            if (previous === parent) continue;
            if (previous !== undefined) this.world.removeParent(child);
            if (parent !== undefined) attach.push([child, parent]);
        }
        // A valid batch can reverse a chain. Release all obsolete links before
        // adding any, so its iteration order cannot produce a temporary cycle.
        for (const [child, parent] of attach) this.world.setParent(child, parent);
    }

    detachSurvivors(retiring: readonly number[]): Set<number> {
        const gone = new Set(retiring), roots: Entity[] = [], detached = new Set<number>();
        for (const id of gone) {
            const root = this.ids.entityOf(id);
            if (root !== undefined) roots.push(root);
        }
        detachSurvivingDescendants(this.world, roots, child => {
            const id = this.ids.netIdOf(child);
            return id !== undefined && !gone.has(id);
        }, (world, child) => {
            detached.add(this.ids.netIdOf(child)!);
            world.removeParent(child);
        });
        return detached;
    }

    forget(child: number): void { this.links.set(child, undefined); }
    clear(): void { this.links.clear(); }
}
