/**
 * @file    commands.ts
 * @brief   Deferred entity/component operations (spawn, despawn, insert, remove)
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

import { Entity } from '../core/Types';
import { ComponentDef } from './component';
import { Schema, InferSchema } from './types';
import { World, AnyComponentDef } from './world';
import { ResourceDef, ResourceStorage } from './resource';
import { BuiltinComponentDef, isBuiltinComponent, getBuiltinDefaults } from './builtin';

// =============================================================================
// Commands Descriptor (for system parameters)
// =============================================================================

export interface CommandsDescriptor {
    readonly _type: 'commands';
}

export function Commands(): CommandsDescriptor {
    return { _type: 'commands' };
}

// =============================================================================
// Command Types
// =============================================================================

interface SpawnCommand {
    type: 'spawn';
    components: Map<symbol, unknown>;
    entityRef: { entity: Entity };
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

interface InsertResourceCommand {
    type: 'insert_resource';
    resource: ResourceDef<unknown>;
    value: unknown;
}

interface RemoveResourceCommand {
    type: 'remove_resource';
    resource: ResourceDef<unknown>;
}

type Command =
    | SpawnCommand
    | DespawnCommand
    | InsertCommand
    | RemoveCommand
    | InsertResourceCommand
    | RemoveResourceCommand;

// =============================================================================
// Entity Commands (Builder for spawning)
// =============================================================================

export class EntityCommands {
    private readonly commands_: CommandsInstance;
    private readonly entityRef_: { entity: Entity };
    private readonly components_ = new Map<symbol, unknown>();
    private isNew_: boolean;

    constructor(commands: CommandsInstance, entity: Entity | null) {
        this.commands_ = commands;

        if (entity === null) {
            this.entityRef_ = { entity: 0 as Entity };
            this.isNew_ = true;
        } else {
            this.entityRef_ = { entity };
            this.isNew_ = false;
        }
    }

    insert<T extends object>(component: AnyComponentDef, data?: Partial<T>): this {
        let instance: unknown;

        if (isBuiltinComponent(component)) {
            const defaults = getBuiltinDefaults(component) as object;
            instance = { ...defaults, ...(data as object) };
        } else {
            instance = (component as ComponentDef<Schema>).create(data as never);
        }

        if (this.isNew_) {
            this.components_.set(component._id, instance);
        } else {
            this.commands_.queueInsert(this.entityRef_.entity, component, instance);
        }

        return this;
    }

    remove(component: AnyComponentDef): this {
        if (!this.isNew_) {
            this.commands_.queueRemove(this.entityRef_.entity, component);
        }
        return this;
    }

    id(): Entity {
        if (this.isNew_ && this.entityRef_.entity === 0) {
            this.finalize();
        }
        return this.entityRef_.entity;
    }

    private finalize(): void {
        if (this.isNew_) {
            this.commands_.queueSpawn(this.components_, this.entityRef_);
        }
    }
}

// =============================================================================
// Commands Instance (Runtime)
// =============================================================================

export class CommandsInstance {
    private readonly world_: World;
    private readonly resources_: ResourceStorage;
    private pending_: Command[] = [];

    constructor(world: World, resources: ResourceStorage) {
        this.world_ = world;
        this.resources_ = resources;
    }

    spawn(): EntityCommands {
        return new EntityCommands(this, null);
    }

    entity(entity: Entity): EntityCommands {
        return new EntityCommands(this, entity);
    }

    despawn(entity: Entity): this {
        this.pending_.push({ type: 'despawn', entity });
        return this;
    }

    insertResource<T>(resource: ResourceDef<T>, value: T): this {
        this.pending_.push({
            type: 'insert_resource',
            resource: resource as ResourceDef<unknown>,
            value
        });
        return this;
    }

    removeResource<T>(resource: ResourceDef<T>): this {
        this.pending_.push({
            type: 'remove_resource',
            resource: resource as ResourceDef<unknown>
        });
        return this;
    }

    queueSpawn(components: Map<symbol, unknown>, entityRef: { entity: Entity }): void {
        this.pending_.push({ type: 'spawn', components, entityRef });
    }

    queueInsert(entity: Entity, component: AnyComponentDef, data: unknown): void {
        this.pending_.push({ type: 'insert', entity, component, data });
    }

    queueRemove(entity: Entity, component: AnyComponentDef): void {
        this.pending_.push({ type: 'remove', entity, component });
    }

    flush(): void {
        for (const cmd of this.pending_) {
            this.executeCommand(cmd);
        }
        this.pending_ = [];
    }

    private executeCommand(cmd: Command): void {
        switch (cmd.type) {
            case 'spawn': {
                const entity = this.world_.spawn();
                cmd.entityRef.entity = entity;

                for (const [compId, data] of cmd.components) {
                    const key = Symbol.for(compId.toString());
                    this.world_.tsRegistry.emplace(entity, key, data);
                }
                break;
            }

            case 'despawn':
                this.world_.despawn(cmd.entity);
                break;

            case 'insert':
                this.world_.insert(cmd.entity, cmd.component, cmd.data as never);
                break;

            case 'remove':
                this.world_.remove(cmd.entity, cmd.component);
                break;

            case 'insert_resource':
                this.resources_.insert(cmd.resource, cmd.value);
                break;

            case 'remove_resource':
                this.resources_.remove(cmd.resource);
                break;
        }
    }
}
