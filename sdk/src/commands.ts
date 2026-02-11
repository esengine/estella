/**
 * @file    commands.ts
 * @brief   Deferred entity/component operations
 */

import { Entity } from './types';
import { AnyComponentDef, ComponentDef, isBuiltinComponent } from './component';
import type { World } from './world';
import { ResourceDef, ResourceStorage } from './resource';

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

interface SpawnComponentEntry {
    component: AnyComponentDef;
    data: unknown;
}

interface SpawnCommand {
    type: 'spawn';
    components: SpawnComponentEntry[];
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

type Command =
    | SpawnCommand
    | DespawnCommand
    | InsertCommand
    | RemoveCommand
    | InsertResourceCommand;

// =============================================================================
// Entity Commands (Builder for spawning)
// =============================================================================

export class EntityCommands {
    private readonly commands_: CommandsInstance;
    private readonly entityRef_: { entity: Entity };
    private readonly components_: SpawnComponentEntry[] = [];
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
            instance = { ...component._default, ...(data as object) };
        } else {
            instance = (component as ComponentDef<T>).create(data);
        }

        if (this.isNew_) {
            this.components_.push({ component, data: instance });
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

    finalize(): void {
        if (this.isNew_) {
            this.commands_.spawnImmediate(this.components_, this.entityRef_);
            this.isNew_ = false;
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
    private spawned_: EntityCommands[] = [];

    constructor(world: World, resources: ResourceStorage) {
        this.world_ = world;
        this.resources_ = resources;
    }

    spawn(): EntityCommands {
        const ec = new EntityCommands(this, null);
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

    spawnImmediate(components: SpawnComponentEntry[], entityRef: { entity: Entity }): void {
        const entity = this.world_.spawn();
        entityRef.entity = entity;

        for (const entry of components) {
            this.world_.insert(entity, entry.component, entry.data);
        }
    }

    flush(): void {
        for (const ec of this.spawned_) {
            ec.finalize();
        }
        this.spawned_ = [];

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
                for (const entry of cmd.components) {
                    this.world_.insert(entity, entry.component, entry.data);
                }
                break;
            }

            case 'despawn':
                this.world_.despawn(cmd.entity);
                break;

            case 'insert':
                this.world_.insert(cmd.entity, cmd.component, cmd.data);
                break;

            case 'remove':
                this.world_.remove(cmd.entity, cmd.component);
                break;

            case 'insert_resource':
                this.resources_.insert(cmd.resource, cmd.value);
                break;
        }
    }
}
