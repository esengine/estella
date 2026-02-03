/**
 * @file    Command.ts
 * @brief   Command interface for undo/redo system
 */

// =============================================================================
// Command Interface
// =============================================================================

export interface Command {
    readonly id: string;
    readonly type: string;
    readonly timestamp: number;
    readonly description: string;

    execute(): void;
    undo(): void;

    canMerge(other: Command): boolean;
    merge(other: Command): Command;
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
}
