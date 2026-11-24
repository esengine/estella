// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    commands.ts
 * @brief   Deferred entity/component operations
 */

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
* @file    commands.ts
* @brief   Deferred entity/component operations
*/
import { INVALID_ENTITY, type Entity } from '../types';
import { type AnyComponentDef, type ComponentDef, isBuiltinComponent } from './component';
import type { World } from './world';
import { type ResourceDef, ResourceStorage } from './resource';
import { log } from '../util/logger';

/** Key order is not a difference a replay should report, so sort it away. */
function stableText(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
    if (Array.isArray(value)) return `[${value.map(stableText).join(',')}]`;
    const rec = value as Record<string, unknown>;
    return `{${Object.keys(rec).sort().map((k) => `${k}:${stableText(rec[k])}`).join(',')}}`;
}

// =============================================================================
// Commands Descriptor (for system parameters)
// =============================================================================

/**
 * A request for a command queue in a system's parameter list, as
 * {@link Commands} returns it. Opaque — the system body receives a
 * `CommandsInstance`, which is the thing with methods.
 *
 * @public
 */
export interface CommandsDescriptor {
    /** @internal */
    readonly _type: 'commands';
}

/**
 * Ask a system for a command queue: spawning, despawning and adding or removing
 * components, recorded now and applied together.
 *
 * It flushes when the system returns — on a throw too, and after an async body's
 * await — so structural edits never land mid-iteration of that system's queries.
 *
 * @public
 */
export function Commands(): CommandsDescriptor {
    return { _type: 'commands' };
}

// =============================================================================
// Command Types
// =============================================================================

interface SpawnComponentEntry {
    component: AnyComponentDef;
    data: unknown;
}

interface DespawnCommand {
    type: 'despawn';
    entity: Entity;
}

interface InsertCommand {
    type: 'insert';
    entity: Entity;
    component: AnyComponentDef;
    data: unknown;
}

interface RemoveCommand {
    type: 'remove';
    entity: Entity;
    component: AnyComponentDef;
}

interface SetParentCommand {
    type: 'set_parent';
    entity: Entity;
    parent: Entity;
}

interface InsertResourceCommand {
    type: 'insert_resource';
    resource: ResourceDef<unknown>;
    value: unknown;
}

type Command =
    | DespawnCommand
    | InsertCommand
    | RemoveCommand
    | SetParentCommand
    | InsertResourceCommand;

// =============================================================================
// Entity Commands (Builder for spawning)
// =============================================================================

/**
 * One entity's share of a {@link CommandsInstance}: chain `insert`/`remove` and
 * let the queue apply them. Asking {@link EntityCommands.id} for a spawn's
 * entity materialises it early, because an id has to exist to be answered —
 * except inside a running query, where the id is reserved and the spawn still
 * lands at the flush.
 *
 * @public
 */
export class EntityCommands {
    private readonly commands_: CommandsInstance;
    private readonly entityRef_: { entity: Entity };
    private readonly components_: SpawnComponentEntry[] = [];
    private readonly spawnName_?: string;
    private phase_: 'queued' | 'publishing' | 'existing';
    private parent_: Entity | null = null;

    constructor(commands: CommandsInstance, entity: Entity | null, name?: string) {
        this.commands_ = commands;

        if (entity === null) {
            this.entityRef_ = { entity: 0 as Entity };
            this.phase_ = 'queued';
            this.spawnName_ = name;
        } else {
            this.entityRef_ = { entity };
            this.phase_ = 'existing';
        }
    }

    /** @internal What this spawn or edit WOULD do, as text a second run can be
     *  compared against — a queued spawn has no entity yet, so identity cannot
     *  be part of the comparison and the composition is. */
    describe(): string {
        const parts = this.components_.map((c) => `${c.component._name}=${stableText(c.data)}`).sort();
        return `${this.phase_ === 'existing' ? `edit#${this.entityRef_.entity}` : 'spawn'}`
            + `${this.spawnName_ ? `:${this.spawnName_}` : ''}`
            + `(${parts.join(',')})${this.parent_ === null ? '' : `<-${this.parent_}`}`;
    }

    insert<T extends object>(component: AnyComponentDef, data?: Partial<T>): this {
        let instance: unknown;

        if (isBuiltinComponent(component)) {
            instance = { ...component._default, ...(data as object) };
        } else {
            instance = (component as ComponentDef<T>).create(data);
        }

        if (this.phase_ !== 'existing') {
            this.components_.push({ component, data: instance });
        } else {
            this.commands_.queueInsert(this.entityRef_.entity, component, instance);
        }

        return this;
    }

    remove(component: AnyComponentDef): this {
        if (this.phase_ === 'existing') {
            this.commands_.queueRemove(this.entityRef_.entity, component);
        }
        return this;
    }

    /**
     * Attach this entity under `parent`. The engine keeps {@link Parent} and
     * {@link Children} in step from here — inserting `Parent` yourself writes
     * only one half of the link.
     */
    childOf(parent: Entity): this {
        if (this.phase_ !== 'existing') {
            this.parent_ = parent;
        } else {
            this.commands_.queueSetParent(this.entityRef_.entity, parent);
        }
        return this;
    }

    /** The allocated handle, or INVALID_ENTITY once the queue's world has been replaced. */
    id(): Entity {
        if (this.phase_ === 'queued' && this.entityRef_.entity === INVALID_ENTITY) {
            // Inside a running query the spawn cannot happen yet, but its identity
            // can: reserve it, and let the flush spawn into it. Outside one the
            // spawn lands now, as it always has.
            if (this.commands_.isWorldIterating()) this.entityRef_.entity = this.commands_.reserveEntity();
            else this.finalize();
        }
        return this.commands_.isCurrent() ? this.entityRef_.entity : INVALID_ENTITY;
    }

    finalize(): void {
        if (this.phase_ !== 'queued') return;
        this.phase_ = 'publishing';
        try {
            this.commands_.spawnImmediate(this.components_, this.entityRef_, this.spawnName_, this.parent_);
            this.phase_ = 'existing';
            this.parent_ = null;
        } catch (error) {
            this.phase_ = 'queued';
            throw error;
        }
    }
}

// =============================================================================
// Commands Instance (Runtime)
// =============================================================================

/**
 * The command queue a system declared with {@link Commands}. Records structural
 * work — spawn, despawn, add or remove a component, install a resource — and
 * applies it when the system returns, so nothing moves under a running query.
 * If the world restarts during the run, the outgoing queue discards its remaining work.
 *
 * @public
 */
export class CommandsInstance {
    private readonly world_: World;
    private readonly resources_: ResourceStorage;
    private readonly lifetime_: symbol;
    private pending_: Command[] = [];
    private spawned_: EntityCommands[] = [];
    private nextSpawn_ = 0;
    private nextCommand_ = 0;

    constructor(world: World, resources: ResourceStorage) {
        this.world_ = world;
        this.resources_ = resources;
        this.lifetime_ = world.entityLifetime;
    }

    /** @internal A builder and its queue share the entity population of the invocation that created them. */
    isCurrent(): boolean {
        return this.world_.entityLifetime === this.lifetime_;
    }

    spawn(name?: string): EntityCommands {
        const ec = new EntityCommands(this, null, name);
        this.spawned_.push(ec);
        return ec;
    }

    entity(entity: Entity): EntityCommands {
        return new EntityCommands(this, entity);
    }

    despawn(entity: Entity): this {
        this.pending_.push({ type: 'despawn', entity });
        return this;
    }

    /**
     * A world-level service, for the work no component write can express.
     * Returns null when the service is absent or the invocation's world has retired.
     */
    resource<T>(def: ResourceDef<T>): T | null {
        return this.isCurrent() && this.resources_.has(def) ? this.resources_.get(def) : null;
    }

    insertResource<T>(resource: ResourceDef<T>, value: T): this {
        this.pending_.push({
            type: 'insert_resource',
            resource: resource as ResourceDef<unknown>,
            value
        });
        return this;
    }

    queueInsert(entity: Entity, component: AnyComponentDef, data: unknown): void {
        this.pending_.push({ type: 'insert', entity, component, data });
    }

    queueRemove(entity: Entity, component: AnyComponentDef): void {
        this.pending_.push({ type: 'remove', entity, component });
    }

    queueSetParent(entity: Entity, parent: Entity): void {
        this.pending_.push({ type: 'set_parent', entity, parent });
    }

    /** @internal Whether the world is inside a query walk, where a spawn must wait. */
    isWorldIterating(): boolean {
        return this.world_.isIterating();
    }

    /** @internal An identity for a spawn that will be applied at flush. */
    reserveEntity(): Entity {
        return this.isCurrent() ? this.world_.reserveEntity() : INVALID_ENTITY;
    }

    /** @internal How EntityCommands applies a deferred spawn — `entityRef` is the
     *  handle it already gave the caller, filled in once the entity exists. */
    spawnImmediate(
        components: SpawnComponentEntry[],
        entityRef: { entity: Entity },
        name?: string,
        parent?: Entity | null,
    ): void {
        // A reserved id (see EntityCommands.id) is spawned into, not replaced.
        if (!this.isCurrent()) return;
        if (entityRef.entity !== INVALID_ENTITY && this.world_.valid(entityRef.entity)) {
            this.world_.commitReservedSpawn(entityRef.entity, name);
        } else {
            // An onSpawn observer can ask the same builder for its id.
            this.world_.spawnImmediate(name, entity => { entityRef.entity = entity; });
        }
        const entity = entityRef.entity;

        for (const entry of components) {
            if (!this.isCurrent()) return;
            this.world_.insert(entity, entry.component, entry.data as Record<string, unknown>);
        }

        if (parent != null && this.isCurrent()) {
            this.world_.setParent(entity, parent);
        }
    }

    /** @internal Everything queued and not yet applied, as comparable text. */
    describe(): string {
        const spawned = this.spawned_.map((ec) => ec.describe());
        const pending = this.pending_.map((c) => {
            const anyCmd = c as { type: string; entity?: Entity; component?: { _name: string }; data?: unknown };
            return `${anyCmd.type}#${anyCmd.entity ?? '-'}`
                + `${anyCmd.component ? `:${anyCmd.component._name}` : ''}`
                + `${anyCmd.data === undefined ? '' : `=${stableText(anyCmd.data)}`}`;
        });
        return [...spawned, ...pending].join('|');
    }

    flush(): void {
        // Advance before calling out. A listener can flush newly queued work synchronously.
        while (this.nextSpawn_ < this.spawned_.length) {
            const spawn = this.spawned_[this.nextSpawn_++]!;
            try { spawn.finalize(); }
            catch (error) {
                // A nested flush may already have drained the list. The failing builder still owns its id.
                if (!this.spawned_.includes(spawn)) this.spawned_.push(spawn);
                this.nextSpawn_ = 0;
                throw error;
            }
        }
        this.spawned_.length = 0;
        this.nextSpawn_ = 0;

        while (this.nextCommand_ < this.pending_.length && this.isCurrent()) {
            const cmd = this.pending_[this.nextCommand_++]!;
            try { this.executeCommand(cmd); }
            catch (e) { log.warn('commands', `Failed to execute command: ${cmd.type}`, e); }
        }
        this.pending_.length = 0;
        this.nextCommand_ = 0;
    }

    private executeCommand(cmd: Command): void {
        switch (cmd.type) {
            case 'despawn':
                if (!this.world_.valid(cmd.entity)) {
                    log.warn('commands', `despawn skipped: entity ${cmd.entity} is already invalid`);
                    break;
                }
                this.world_.despawn(cmd.entity);
                break;

            case 'insert':
                if (!this.world_.valid(cmd.entity)) {
                    log.warn('commands', `insert skipped: entity ${cmd.entity} is invalid`);
                    break;
                }
                this.world_.insert(cmd.entity, cmd.component, cmd.data as Record<string, unknown>);
                break;

            case 'remove':
                if (!this.world_.valid(cmd.entity)) {
                    log.warn('commands', `remove skipped: entity ${cmd.entity} is invalid`);
                    break;
                }
                this.world_.remove(cmd.entity, cmd.component);
                break;

            case 'set_parent':
                if (!this.world_.valid(cmd.entity) || !this.world_.valid(cmd.parent)) {
                    log.warn('commands', `childOf skipped: entity ${cmd.entity} or parent ${cmd.parent} is invalid`);
                    break;
                }
                this.world_.setParent(cmd.entity, cmd.parent);
                break;

            case 'insert_resource':
                this.resources_.insert(cmd.resource, cmd.value);
                break;
        }
    }
}
