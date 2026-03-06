/**
 * @file    Command.ts
 * @brief   Command interface for undo/redo system
 */

import type { EntityData, SceneData } from '../types/SceneTypes';

// =============================================================================
// SerializedCommand
// =============================================================================

export interface SerializedCommand {
    type: string;
    data: Record<string, unknown>;
}

export type CommandDeserializer = (
    data: Record<string, unknown>,
    scene: SceneData,
    entityMap: Map<number, EntityData>,
) => Command;

// =============================================================================
// CommandRegistry
// =============================================================================

const deserializers_ = new Map<string, CommandDeserializer>();

export const CommandRegistry = {
    register(type: string, deserializer: CommandDeserializer): void {
        deserializers_.set(type, deserializer);
    },

    deserialize(
        serialized: SerializedCommand,
        scene: SceneData,
        entityMap: Map<number, EntityData>,
    ): Command | null {
        const deserializer = deserializers_.get(serialized.type);
        if (!deserializer) return null;
        return deserializer(serialized.data, scene, entityMap);
    },

    has(type: string): boolean {
        return deserializers_.has(type);
    },
};

// =============================================================================
// ChangeEmitter Interface
// =============================================================================

export interface ChangeEmitter {
    notifyPropertyChange(event: {
        entity: number; componentType: string; propertyName: string;
        oldValue: unknown; newValue: unknown;
    }): void;
    notifyVisibilityChange(event: { entity: number; visible: boolean }): void;
    notifyHierarchyChange(event: { entity: number; newParent: number | null }): void;
    notifyEntityLifecycle(event: {
        entity: number; type: 'created' | 'deleted'; parent: number | null;
    }): void;
    notifyComponentChange(event: {
        entity: number; componentType: string; action: 'added' | 'removed';
    }): void;
}

// =============================================================================
// Command Interface
// =============================================================================

export interface Command {
    readonly id: string;
    readonly type: string;
    readonly timestamp: number;
    readonly description: string;
    readonly structural: boolean;

    execute(): void;
    undo(): void;

    canMerge(other: Command): boolean;
    merge(other: Command): Command;

    updateEntityMap(map: Map<number, EntityData>, isUndo: boolean): void;
    emitChangeEvents(emitter: ChangeEmitter, isUndo: boolean): void;

    serialize(): SerializedCommand | null;
}

// =============================================================================
// Base Command
// =============================================================================

let commandIdCounter = 0;

export abstract class BaseCommand implements Command {
    readonly id: string;
    readonly timestamp: number;
    abstract readonly type: string;
    abstract readonly description: string;
    readonly structural: boolean = false;

    constructor() {
        this.id = `cmd_${++commandIdCounter}_${Date.now()}`;
        this.timestamp = Date.now();
    }

    abstract execute(): void;
    abstract undo(): void;

    canMerge(_other: Command): boolean {
        return false;
    }

    merge(_other: Command): Command {
        return this;
    }

    updateEntityMap(_map: Map<number, EntityData>, _isUndo: boolean): void {}
    emitChangeEvents(_emitter: ChangeEmitter, _isUndo: boolean): void {}

    serialize(): SerializedCommand | null {
        return null;
    }
}
